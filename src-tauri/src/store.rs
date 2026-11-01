//! Durable local store: threads, their events and a small key/value table. SQLite in WAL
//! mode under the app folder. The UI still keeps live state in memory; this is the history
//! that survives a restart, a crash or a closed pane, and the source for search.
//!
//! No prompts or credentials are duplicated here: `snapshot` is the pane metadata the
//! frontend already saves in `layout.json` (folder, branch, session id, title), and events
//! are short status lines. Secrets stay in the Keychain.

use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct Db {
    conn: Mutex<Option<Connection>>,
}

impl Default for Db {
    fn default() -> Self {
        Self { conn: Mutex::new(None) }
    }
}

fn db_path() -> PathBuf {
    crate::config::app_dir().join("aurelia.db")
}

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  project TEXT,
  cwd TEXT,
  harness TEXT,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  snapshot TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS threads_updated ON threads(updated_at DESC);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_thread ON events(thread_id, id);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"#;

/// Opens the database and installs it in Tauri state. A failure is reported, not fatal:
/// the app still runs, only history is unavailable.
pub fn init(app: &AppHandle) -> Result<(), String> {
    let conn = Connection::open(db_path()).map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    let state = app.state::<Db>();
    *state.conn.lock().unwrap() = Some(conn);
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn text(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(String::from)
}

fn int(v: &Value, key: &str) -> Option<i64> {
    v.get(key).and_then(Value::as_i64)
}

fn upsert(conn: &Connection, thread: &Value) -> Result<(), String> {
    let id = text(thread, "id").ok_or("thread.id is required")?;
    let title = text(thread, "title").unwrap_or_default();
    let project = text(thread, "project");
    let cwd = text(thread, "cwd");
    let harness = text(thread, "harness");
    let session = text(thread, "sessionId").or_else(|| text(thread, "session"));
    let status = text(thread, "status").unwrap_or_else(|| "open".into());
    let snapshot = serde_json::to_string(thread).map_err(|e| e.to_string())?;
    let created = int(thread, "createdAt").unwrap_or_else(now_ms);
    let updated = int(thread, "updatedAt").unwrap_or_else(now_ms);
    conn.execute(
        "INSERT INTO threads (id, title, project, cwd, harness, session_id, status, snapshot, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, project=excluded.project, cwd=excluded.cwd,
           harness=excluded.harness, session_id=excluded.session_id, status=excluded.status,
           snapshot=excluded.snapshot, updated_at=excluded.updated_at",
        params![id, title, project, cwd, harness, session, status, snapshot, created, updated],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn list(conn: &Connection, limit: usize) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT snapshot FROM threads ORDER BY updated_at DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit as i64], |row| row.get::<_, Option<String>>(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        if let Some(s) = row.map_err(|e| e.to_string())? {
            if let Ok(v) = serde_json::from_str::<Value>(&s) {
                out.push(v);
            }
        }
    }
    Ok(out)
}

fn search(conn: &Connection, query: &str, limit: usize) -> Result<Vec<Value>, String> {
    let q = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
    let mut stmt = conn
        .prepare(
            "SELECT snapshot FROM threads
             WHERE title LIKE ?1 ESCAPE '\\' OR project LIKE ?1 ESCAPE '\\' OR snapshot LIKE ?1 ESCAPE '\\'
             ORDER BY updated_at DESC LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![q, limit as i64], |row| row.get::<_, Option<String>>(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        if let Some(s) = row.map_err(|e| e.to_string())? {
            if let Ok(v) = serde_json::from_str::<Value>(&s) {
                out.push(v);
            }
        }
    }
    Ok(out)
}

fn append_event(conn: &Connection, thread_id: &str, kind: &str, payload: &Value) -> Result<(), String> {
    conn.execute(
        "INSERT INTO events (thread_id, kind, payload, at) VALUES (?1, ?2, ?3, ?4)",
        params![thread_id, kind, payload.to_string(), now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn events(conn: &Connection, thread_id: &str, limit: usize) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT id, kind, payload, at FROM events WHERE thread_id = ?1 ORDER BY id DESC LIMIT ?2")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![thread_id, limit as i64], |row| {
            Ok(json!({
                "id": row.get::<_, i64>(0)?,
                "kind": row.get::<_, String>(1)?,
                "payload": row.get::<_, Option<String>>(2)?.and_then(|s| serde_json::from_str::<Value>(&s).ok()),
                "at": row.get::<_, i64>(3)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn stats(conn: &Connection) -> Result<Value, String> {
    let threads: i64 = conn.query_row("SELECT COUNT(*) FROM threads", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    let events: i64 = conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    Ok(json!({ "threads": threads, "events": events, "path": db_path().to_string_lossy() }))
}

fn with_conn<T>(db: &Db, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let guard = db.conn.lock().unwrap();
    let conn = guard.as_ref().ok_or("the local store isn't open")?;
    f(conn)
}

#[tauri::command]
pub fn store_thread_upsert(db: tauri::State<'_, Db>, thread: Value) -> Result<(), String> {
    with_conn(&db, |c| upsert(c, &thread))
}

#[tauri::command]
pub fn store_threads(db: tauri::State<'_, Db>, limit: Option<usize>) -> Result<Vec<Value>, String> {
    with_conn(&db, |c| list(c, limit.unwrap_or(200).clamp(1, 2000)))
}

#[tauri::command]
pub fn store_thread_delete(db: tauri::State<'_, Db>, id: String) -> Result<(), String> {
    with_conn(&db, |c| {
        c.execute("DELETE FROM events WHERE thread_id = ?1", params![id]).map_err(|e| e.to_string())?;
        c.execute("DELETE FROM threads WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn store_thread_search(db: tauri::State<'_, Db>, query: String, limit: Option<usize>) -> Result<Vec<Value>, String> {
    with_conn(&db, |c| search(c, &query, limit.unwrap_or(50).clamp(1, 500)))
}

#[tauri::command]
pub fn store_event_append(db: tauri::State<'_, Db>, thread_id: String, kind: String, payload: Option<Value>) -> Result<(), String> {
    with_conn(&db, |c| append_event(c, &thread_id, &kind, &payload.unwrap_or(Value::Null)))
}

#[tauri::command]
pub fn store_events(db: tauri::State<'_, Db>, thread_id: String, limit: Option<usize>) -> Result<Vec<Value>, String> {
    with_conn(&db, |c| events(c, &thread_id, limit.unwrap_or(200).clamp(1, 2000)))
}


/// Reads a JSON state file once and writes it into the store as threads. Used by the
/// one-time migration from `layout.json` / the closed-thread stack.
#[tauri::command]
pub fn store_import_threads(db: tauri::State<'_, Db>, threads: Vec<Value>) -> Result<usize, String> {
    with_conn(&db, |c| {
        let mut n = 0;
        for t in &threads {
            if upsert(c, t).is_ok() {
                n += 1;
            }
        }
        Ok(n)
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub ok: bool,
    pub threads: i64,
    pub events: i64,
    pub path: String,
}

#[tauri::command]
pub fn store_health(db: tauri::State<'_, Db>) -> Health {
    match with_conn(&db, |c| stats(c)) {
        Ok(v) => Health {
            ok: true,
            threads: v["threads"].as_i64().unwrap_or(0),
            events: v["events"].as_i64().unwrap_or(0),
            path: v["path"].as_str().unwrap_or("").to_string(),
        },
        Err(e) => Health { ok: false, threads: 0, events: 0, path: e },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(SCHEMA).unwrap();
        c
    }

    #[test]
    fn upsert_updates_the_same_thread_and_lists_newest_first() {
        let c = mem();
        upsert(&c, &json!({"id":"a","title":"First","project":"p","createdAt":1,"updatedAt":1})).unwrap();
        upsert(&c, &json!({"id":"b","title":"Second","project":"p","createdAt":2,"updatedAt":2})).unwrap();
        upsert(&c, &json!({"id":"a","title":"First again","updatedAt":3})).unwrap();
        let rows = list(&c, 10).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["title"], "First again");
        assert_eq!(rows[1]["title"], "Second");
    }

    #[test]
    fn search_finds_titles_and_projects_and_escapes_wildcards() {
        let c = mem();
        upsert(&c, &json!({"id":"a","title":"Fix auth","project":"web","updatedAt":1})).unwrap();
        upsert(&c, &json!({"id":"b","title":"100% done","project":"docs","updatedAt":2})).unwrap();
        assert_eq!(search(&c, "auth", 10).unwrap()[0]["id"], "a");
        assert_eq!(search(&c, "web", 10).unwrap()[0]["id"], "a");
        assert_eq!(search(&c, "%", 10).unwrap().len(), 1);
    }

    #[test]
    fn events_are_kept_per_thread_newest_first() {
        let c = mem();
        append_event(&c, "a", "settled", &json!({"why":"pr merged"})).unwrap();
        append_event(&c, "a", "reopened", &Value::Null).unwrap();
        append_event(&c, "b", "settled", &Value::Null).unwrap();
        let rows = events(&c, "a", 10).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["kind"], "reopened");
        assert_eq!(rows[1]["payload"]["why"], "pr merged");
    }
}
