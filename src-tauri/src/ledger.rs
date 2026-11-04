//! API shadow bill: what this computer's agent use would cost at list prices. Reads the
//! Claude Code logs of every account (subagents included) into a small SQLite file, one row
//! per model reply, and prices them at the live list. Nothing here leaves the machine: the
//! only network call is the public pricing page, at most once a day.
//!
//! Codex is left out on purpose: its session logs (2026-11) carry no token counts, so any
//! number would be a guess. The popover says so.

use crate::config;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const PRICING_URL: &str = "https://platform.claude.com/docs/en/about-claude/pricing.md";
const PRICE_TTL: Duration = Duration::from_secs(24 * 3600);
const DAY_MS: i64 = 24 * 3600 * 1000;
/// A little over the longest window; Claude Code deletes its logs after 30 days anyway.
const KEEP_DAYS: i64 = 35;
const WINDOWS: [(&str, i64); 3] = [("24h", 1), ("7d", 7), ("30d", 30)];

/// One model reply.
#[derive(Debug, Clone, PartialEq)]
struct Reply {
    id: String,
    at: i64,
    model: String,
    input: u64,
    output: u64,
    cache_read: u64,
    write_5m: u64,
    write_1h: u64,
    fast: bool,
}

/// `2026-11-02T16:00:00.123Z` as epoch ms. Logs are always UTC.
pub fn parse_time(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[10] != b'T' || !s.ends_with('Z') {
        return None;
    }
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (n(0..4)?, n(5..7)?, n(8..10)?);
    let (h, min, sec) = (n(11..13)?, n(14..16)?, n(17..19)?);
    let ms = s.get(20..23).and_then(|f| f.parse::<i64>().ok()).unwrap_or(0);
    // Days from civil (Howard Hinnant's algorithm).
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(days * DAY_MS + (h * 3600 + min * 60 + sec) * 1000 + ms)
}

/// One transcript line as a reply, when it is one. Claude Code writes a line per content
/// block, all with the same message id; the row is replaced, so the last counts win.
fn parse_line(line: &str) -> Option<Reply> {
    if !line.contains("\"usage\"") {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    if v["type"] != "assistant" {
        return None;
    }
    let m = &v["message"];
    let model = m["model"].as_str().filter(|s| !s.is_empty() && !s.starts_with('<'))?;
    let id = m["id"].as_str().filter(|s| !s.is_empty())?;
    let u = m["usage"].as_object()?;
    let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
    let write = n("cache_creation_input_tokens");
    let write_1h = u.get("cache_creation").and_then(|c| c["ephemeral_1h_input_tokens"].as_u64()).unwrap_or(0).min(write);
    Some(Reply {
        id: id.to_string(),
        at: parse_time(v["timestamp"].as_str()?)?,
        model: model.to_string(),
        input: n("input_tokens"),
        output: n("output_tokens"),
        cache_read: n("cache_read_input_tokens"),
        write_5m: write - write_1h,
        write_1h,
        fast: u.get("speed").and_then(Value::as_str) == Some("fast"),
    })
}

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS replies (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  model TEXT NOT NULL,
  fast INTEGER NOT NULL,
  input INTEGER NOT NULL,
  output INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  write_5m INTEGER NOT NULL,
  write_1h INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS replies_at ON replies(at);
CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, offset INTEGER NOT NULL);
"#;

fn open() -> Result<Connection, String> {
    let conn = Connection::open(config::app_dir().join("ledger.db")).map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    Ok(conn)
}

fn insert(conn: &Connection, r: &Reply) -> rusqlite::Result<()> {
    conn.prepare_cached("INSERT OR REPLACE INTO replies VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)")?.execute(params![
        r.id, r.at, r.model, r.fast, r.input as i64, r.output as i64, r.cache_read as i64, r.write_5m as i64, r.write_1h as i64
    ])?;
    Ok(())
}

fn collect(dir: &Path, since: SystemTime, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let Ok(t) = e.file_type() else { continue };
        let p = e.path();
        if t.is_dir() {
            collect(&p, since, out);
        } else if t.is_file() && p.extension().is_some_and(|x| x == "jsonl") && e.metadata().and_then(|m| m.modified()).is_ok_and(|m| m >= since) {
            out.push(p);
        }
    }
}

/// Adds what the logs gained since the last scan; a log is only read past its saved offset.
fn scan(conn: &mut Connection, roots: &[PathBuf], now: i64) -> Result<(), String> {
    let since = UNIX_EPOCH + Duration::from_millis((now - KEEP_DAYS * DAY_MS).max(0) as u64);
    let mut files = vec![];
    roots.iter().for_each(|r| collect(r, since, &mut files));
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for path in files {
        let key = path.to_string_lossy().into_owned();
        let saved: i64 = tx.query_row("SELECT offset FROM files WHERE path = ?1", [&key], |r| r.get(0)).unwrap_or(0);
        let Ok(mut f) = std::fs::File::open(&path) else { continue };
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        if len == saved as u64 {
            continue;
        }
        let start = if (saved as u64) > len { 0 } else { saved as u64 };
        let mut buf = vec![];
        if f.seek(SeekFrom::Start(start)).is_err() || f.read_to_end(&mut buf).is_err() {
            continue;
        }
        // A line still being written has no newline yet; it waits for the next scan.
        let end = buf.iter().rposition(|b| *b == b'\n').map_or(0, |i| i + 1);
        for line in String::from_utf8_lossy(&buf[..end]).lines() {
            if let Some(r) = parse_line(line).filter(|r| r.at >= now - KEEP_DAYS * DAY_MS) {
                insert(&tx, &r).map_err(|e| e.to_string())?;
            }
        }
        tx.execute("INSERT OR REPLACE INTO files VALUES (?1, ?2)", params![key, (start + end as u64) as i64]).map_err(|e| e.to_string())?;
    }
    tx.execute("DELETE FROM replies WHERE at < ?1", [now - KEEP_DAYS * DAY_MS]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// $ per million tokens.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
struct Rate {
    input: f64,
    write_5m: f64,
    write_1h: f64,
    read: f64,
    output: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Prices {
    /// Epoch seconds of the fetch.
    fetched_at: u64,
    models: HashMap<String, Rate>,
    /// Fast-mode (input, output).
    fast: HashMap<String, (f64, f64)>,
}

/// `claude-opus-5-5-20260101[1m]` and `Claude Opus 5.5 (…)` both become `opus-5-5`.
fn price_key(name: &str) -> String {
    // What follows the name is a note: `[1m]`, `([limited availability](…))`, `<sup>…`.
    let s = name.to_lowercase();
    let s = s.split(['(', '[', '<']).next().unwrap_or("");
    let s = s.trim().trim_start_matches("claude").trim_start_matches([' ', '-']).replace([' ', '.'], "-");
    match s.rsplit_once('-') {
        Some((head, tail)) if tail.len() == 8 && tail.chars().all(|c| c.is_ascii_digit()) => head.to_string(),
        _ => s,
    }
}

fn dollars(cell: &str) -> Option<f64> {
    let rest = &cell[cell.find('$')? + 1..];
    let end = rest.find(|c: char| !c.is_ascii_digit() && c != '.' && c != ',').unwrap_or(rest.len());
    rest[..end].replace(',', "").trim_end_matches('.').parse().ok()
}

fn cells(line: &str) -> Vec<&str> {
    line.trim().trim_matches('|').split('|').map(str::trim).collect()
}

/// The pricing page's tables. None when its shape changed: better no bill than a wrong one.
fn parse_pricing(md: &str) -> Option<Prices> {
    let section = |title: &str| md.split_once(title).map(|(_, s)| s.split("\n#").next().unwrap_or(s));
    let mut p = Prices::default();
    for line in section("## Model pricing")?.lines() {
        let c = cells(line);
        if c.len() != 6 || !c[0].to_lowercase().starts_with("claude") {
            continue;
        }
        let v: Vec<f64> = c[1..].iter().filter_map(|x| dollars(x)).collect();
        if let [input, write_5m, write_1h, read, output] = v[..] {
            p.models.insert(price_key(c[0]), Rate { input, write_5m, write_1h, read, output });
        }
    }
    for line in section("### Fast mode pricing").unwrap_or("").lines() {
        let c = cells(line);
        if c.len() == 3 && c[0].to_lowercase().starts_with("claude") {
            if let (Some(i), Some(o)) = (dollars(c[1]), dollars(c[2])) {
                c[0].split('/').for_each(|m| {
                    p.fast.insert(price_key(m), (i, o));
                });
            }
        }
    }
    (!p.models.is_empty()).then_some(p)
}

fn cost(prices: &Prices, key: &str, fast: bool, t: &Totals) -> Option<f64> {
    let r = prices.models.get(key)?;
    // Fast mode scales everything by its input premium; the page lists only input and output.
    let (input, output, scale) = match prices.fast.get(key).filter(|_| fast) {
        Some((i, o)) => (*i, *o, i / r.input),
        None => (r.input, r.output, 1.0),
    };
    let sum = t.input * input + t.output * output + t.cache_read * r.read * scale + t.write_5m * r.write_5m * scale + t.write_1h * r.write_1h * scale;
    Some(sum / 1e6)
}

#[derive(Default)]
struct Totals {
    input: f64,
    output: f64,
    cache_read: f64,
    write_5m: f64,
    write_1h: f64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelLine {
    model: String,
    usd: f64,
    tokens: u64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    id: &'static str,
    usd: f64,
    tokens: u64,
    models: Vec<ModelLine>,
    /// Models the price list doesn't have: left out of `usd`, never guessed.
    unpriced: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    windows: Vec<Window>,
    /// Epoch seconds of the price list used; 0 when there is none.
    prices_at: u64,
}

fn window(conn: &Connection, prices: &Prices, id: &'static str, since: i64) -> Result<Window, String> {
    let mut q = conn
        .prepare("SELECT model, fast, SUM(input), SUM(output), SUM(cache_read), SUM(write_5m), SUM(write_1h) FROM replies WHERE at >= ?1 GROUP BY model, fast")
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map([since], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?, Totals { input: r.get(2)?, output: r.get(3)?, cache_read: r.get(4)?, write_5m: r.get(5)?, write_1h: r.get(6)? }))
        })
        .map_err(|e| e.to_string())?;
    let mut models: BTreeMap<String, (f64, u64, bool)> = BTreeMap::new();
    for row in rows {
        let (model, fast, t) = row.map_err(|e| e.to_string())?;
        let key = price_key(&model);
        let usd = cost(prices, &key, fast, &t);
        let e = models.entry(key).or_default();
        e.0 += usd.unwrap_or(0.0);
        e.1 += (t.input + t.output + t.cache_read + t.write_5m + t.write_1h) as u64;
        e.2 |= usd.is_none();
    }
    let unpriced = models.iter().filter(|(_, v)| v.2).map(|(k, _)| k.clone()).collect();
    let mut lines: Vec<ModelLine> = models.into_iter().map(|(model, (usd, tokens, _))| ModelLine { model, usd, tokens }).collect();
    lines.sort_by(|a, b| b.usd.total_cmp(&a.usd).then(b.tokens.cmp(&a.tokens)));
    Ok(Window { id, usd: lines.iter().map(|l| l.usd).sum(), tokens: lines.iter().map(|l| l.tokens).sum(), models: lines, unpriced })
}

fn summarize(conn: &Connection, prices: &Prices, now: i64) -> Result<Summary, String> {
    let windows = WINDOWS.iter().map(|(id, days)| window(conn, prices, id, now - days * DAY_MS)).collect::<Result<_, _>>()?;
    Ok(Summary { windows, prices_at: prices.fetched_at })
}

fn prices_path() -> PathBuf {
    config::app_dir().join("prices.json")
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64
}

/// The saved list, refreshed from the live page once it is a day old. A failed fetch keeps
/// the saved list, whose date the popover shows.
async fn prices() -> Prices {
    let saved: Option<Prices> = std::fs::read_to_string(prices_path()).ok().and_then(|t| serde_json::from_str(&t).ok());
    let now = (now_ms() / 1000) as u64;
    if let Some(p) = saved.as_ref().filter(|p| now.saturating_sub(p.fetched_at) < PRICE_TTL.as_secs()) {
        return p.clone();
    }
    let fetched = async {
        let client = reqwest::Client::builder().timeout(Duration::from_secs(8)).build().ok()?;
        let md = client.get(PRICING_URL).send().await.ok()?.error_for_status().ok()?.text().await.ok()?;
        parse_pricing(&md)
    };
    match fetched.await {
        Some(mut p) => {
            p.fetched_at = now;
            if let Ok(t) = serde_json::to_string(&p) {
                let _ = std::fs::write(prices_path(), t);
            }
            p
        }
        None => saved.unwrap_or_default(),
    }
}

/// One scan at a time.
static SCAN: Mutex<()> = Mutex::new(());

#[tauri::command]
pub async fn ledger_summary() -> Result<Summary, String> {
    let prices = prices().await;
    tauri::async_runtime::spawn_blocking(move || {
        let _one = SCAN.lock().unwrap();
        let cfg = config::load();
        let roots: Vec<PathBuf> = cfg.accounts.iter().map(|a| PathBuf::from(a.resolved_dir()).join("projects")).collect();
        let mut conn = open()?;
        let now = now_ms();
        scan(&mut conn, &roots, now)?;
        summarize(&conn, &prices, now)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_793_000_000_000;

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(SCHEMA).unwrap();
        c
    }

    fn reply(id: &str, at: i64, model: &str, input: u64) -> Reply {
        Reply { id: id.into(), at, model: model.into(), input, output: 0, cache_read: 0, write_5m: 0, write_1h: 0, fast: false }
    }

    fn prices() -> Prices {
        let mut p = Prices { fetched_at: 7, ..Default::default() };
        p.models.insert("opus-5-5".into(), Rate { input: 4.0, write_5m: 5.0, write_1h: 8.0, read: 0.4, output: 20.0 });
        p.fast.insert("opus-5-5".into(), (8.0, 40.0));
        p
    }

    #[test]
    fn times_are_utc_epoch_ms() {
        assert_eq!(parse_time("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_time("2026-11-02T16:00:00.250Z"), Some(1_793_635_200_250));
        assert_eq!(parse_time("2024-03-01T00:00:00Z"), Some(1_709_251_200_000));
        assert_eq!(parse_time("yesterday"), None);
    }

    #[test]
    fn a_line_splits_cache_writes_by_lifetime() {
        let l = r#"{"type":"assistant","timestamp":"2026-11-02T16:00:00.000Z","message":{"id":"msg_1","model":"claude-opus-5-5","usage":{"input_tokens":2,"output_tokens":7,"cache_read_input_tokens":100,"cache_creation_input_tokens":50,"cache_creation":{"ephemeral_1h_input_tokens":30,"ephemeral_5m_input_tokens":20},"speed":"fast"}}}"#;
        let r = parse_line(l).unwrap();
        assert_eq!((r.input, r.output, r.cache_read, r.write_5m, r.write_1h, r.fast), (2, 7, 100, 20, 30, true));
    }

    #[test]
    fn other_lines_and_placeholder_replies_are_skipped() {
        assert_eq!(parse_line(r#"{"type":"user","message":{"usage":{}}}"#), None);
        assert_eq!(parse_line(r#"{"type":"assistant","timestamp":"2026-11-02T16:00:00.000Z","message":{"id":"m","model":"<synthetic>","usage":{}}}"#), None);
    }

    #[test]
    fn windows_cut_at_their_edges() {
        let c = mem();
        for (id, age_h, input) in [("a", 1, 1_000_000), ("b", 23, 1_000_000), ("c", 25, 1_000_000), ("d", 7 * 24 + 1, 1_000_000), ("e", 31 * 24, 1_000_000)] {
            insert(&c, &reply(id, T0 - age_h * 3_600_000, "claude-opus-5-5", input)).unwrap();
        }
        let s = summarize(&c, &prices(), T0).unwrap();
        let usd: Vec<_> = s.windows.iter().map(|w| (w.id, w.usd)).collect();
        assert_eq!(usd, [("24h", 8.0), ("7d", 12.0), ("30d", 16.0)]);
        assert_eq!(s.prices_at, 7);
    }

    #[test]
    fn repeated_lines_and_copied_sessions_count_once_with_the_final_numbers() {
        let c = mem();
        insert(&c, &reply("m", T0, "claude-opus-5-5", 10)).unwrap();
        insert(&c, &reply("m", T0, "claude-opus-5-5", 1_000_000)).unwrap();
        let s = summarize(&c, &prices(), T0 + 1).unwrap();
        assert_eq!(s.windows[0].tokens, 1_000_000);
        assert_eq!(s.windows[0].usd, 4.0);
    }

    #[test]
    fn a_reply_is_priced_by_token_kind() {
        let c = mem();
        let r = Reply { output: 1_000_000, cache_read: 1_000_000, write_5m: 1_000_000, write_1h: 1_000_000, ..reply("m", T0, "claude-opus-5-5", 1_000_000) };
        insert(&c, &r).unwrap();
        let s = summarize(&c, &prices(), T0 + 1).unwrap();
        assert!((s.windows[0].usd - (4.0 + 20.0 + 0.4 + 5.0 + 8.0)).abs() < 1e-9);
    }

    #[test]
    fn fast_mode_pays_its_premium_on_everything() {
        let c = mem();
        insert(&c, &Reply { fast: true, cache_read: 1_000_000, output: 1_000_000, ..reply("m", T0, "claude-opus-5-5", 1_000_000) }).unwrap();
        let s = summarize(&c, &prices(), T0 + 1).unwrap();
        assert!((s.windows[0].usd - (8.0 + 40.0 + 0.8)).abs() < 1e-9);
    }

    #[test]
    fn a_model_without_a_price_is_named_and_left_out() {
        let c = mem();
        insert(&c, &reply("m", T0, "claude-new-9", 1_000_000)).unwrap();
        let w = &summarize(&c, &prices(), T0 + 1).unwrap().windows[0];
        assert_eq!((w.usd, w.unpriced.clone()), (0.0, vec!["new-9".to_string()]));
        assert_eq!(w.tokens, 1_000_000);
    }

    #[test]
    fn scanning_reads_only_what_a_log_gained_and_waits_for_whole_lines() {
        let dir = std::env::temp_dir().join(format!("ledger-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("proj/sub")).unwrap();
        let log = dir.join("proj/sub/s.jsonl");
        let line = |id: &str| format!(r#"{{"type":"assistant","timestamp":"2026-11-02T16:00:00.000Z","message":{{"id":"{id}","model":"claude-opus-5-5","usage":{{"input_tokens":5}}}}}}"#);
        std::fs::write(&log, format!("{}\n{}", line("a"), &line("b")[..20])).unwrap();
        let mut c = mem();
        let now = parse_time("2026-11-02T17:00:00.000Z").unwrap();
        let count = |c: &Connection| c.query_row("SELECT COUNT(*) FROM replies", [], |r| r.get::<_, i64>(0)).unwrap();
        scan(&mut c, &[dir.clone()], now).unwrap();
        assert_eq!(count(&c), 1);
        std::fs::write(&log, format!("{}\n{}\n", line("a"), line("b"))).unwrap();
        scan(&mut c, &[dir.clone()], now).unwrap();
        assert_eq!(count(&c), 2);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_pricing_page_parses_and_model_ids_match_its_names() {
        let md = "## Model pricing\n\n| Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n| Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.40 / MTok | $20 / MTok |\n| Claude Mythos 5 ([limited](https://x.y)) | $25 / MTok | $31.25 / MTok | $50 / MTok | $2.50 / MTok | $125 / MTok |\n\n## Other\n\n| Claude Sonnet 9 | $1 | $1 | $1 | $1 | $1 |\n\n### Fast mode pricing\n\n| Model | Input | Output |\n| --- | --- | --- |\n| Claude Opus 5.5 | $8 / MTok | $40 / MTok |\n";
        let p = parse_pricing(md).unwrap();
        assert_eq!(p.models.len(), 2);
        assert_eq!(p.models[&price_key("claude-opus-5-5-20260101[1m]")].read, 0.4);
        assert_eq!(p.models["mythos-5"].write_5m, 31.25);
        assert_eq!(p.fast["opus-5-5"], (8.0, 40.0));
        assert!(parse_pricing("nothing here").is_none());
    }
}
