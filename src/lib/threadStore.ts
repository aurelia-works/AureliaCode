import { basename } from "./format";
import { db, type StoredThread } from "./db";
import { useLayout, type PaneMeta } from "../store/layout";

/** Pane metadata without the environment: SQLite keeps history, not credentials. */
function safeSnapshot(pane: Partial<PaneMeta>): Partial<PaneMeta> {
  const safe = { ...pane };
  delete safe.env;
  delete safe.secretEnv;
  return safe;
}

/** A pane as a durable thread row. The live layout remains the source of truth while open. */
export function threadFromPane(id: string, pane: PaneMeta, at = Date.now()): StoredThread {
  const title = pane.title?.trim() || basename(pane.cwd ?? "") || (pane.mode === "chat" ? "Chat" : "Terminal");
  const status = pane.settled ? "settled" : pane.snoozedUntil ? "snoozed" : "open";
  return {
    id,
    title,
    project: pane.cwd ?? null,
    cwd: pane.cwd ?? null,
    harness: pane.mode === "chat" ? "claude" : "terminal",
    sessionId: pane.claudeSession ?? null,
    status,
    snapshot: safeSnapshot(pane),
    updatedAt: at,
  };
}

/** Every open pane worth remembering: chats, terminals and browsers, not empty launchers. */
export function openThreads(panes: Record<string, PaneMeta>, at = Date.now()): StoredThread[] {
  return Object.entries(panes)
    .filter(([, p]) => !p.launcher && !p.editor)
    .map(([id, p]) => threadFromPane(id, p, at));
}

let timer: ReturnType<typeof setTimeout> | undefined;
let last = "";
let lastIds = new Set<string>();
let reconciled = false;

/** Marks rows that were open last session but have no pane now as closed, so history has no stale "open" copy. */
function reconcile(ids: Set<string>) {
  void db
    .threads(2000)
    .then((rows) =>
      Promise.all(
        rows
          .filter((r) => r.status === "open" && !ids.has(r.id))
          .map((r) => db.upsertThread({ ...r, status: "closed", updatedAt: Date.now() })),
      ),
    )
    .catch(() => {});
}

/** Mirrors open panes into SQLite, debounced; a no-op when nothing durable changed. */
export function startThreadStore() {
  const flush = () => {
    const { panes } = useLayout.getState();
    const rows = openThreads(panes);
    const key = JSON.stringify(rows.map((r) => [r.id, r.title, r.status, r.sessionId, r.harness, r.cwd]));
    if (key === last) return;
    last = key;
    void Promise.all(rows.map((r) => db.upsertThread(r))).catch(() => {});
    const ids = new Set(rows.map((r) => r.id));
    if (!reconciled || [...lastIds].some((id) => !ids.has(id))) {
      reconciled = true;
      reconcile(ids);
    }
    lastIds = ids;
  };
  flush();
  useLayout.subscribe((s, prev) => {
    if (s.panes === prev.panes) return;
    clearTimeout(timer);
    timer = setTimeout(flush, 700);
  });
}

/** A closed pane keeps its snapshot and can be searched and reopened later. */
export function persistClosedThread(id: string, pane: Partial<PaneMeta>) {
  const at = Date.now();
  return db
    .upsertThread({
      id,
      title: pane.title?.trim() || basename(pane.cwd ?? "") || "Closed thread",
      project: pane.cwd ?? null,
      cwd: pane.cwd ?? null,
      harness: pane.mode === "chat" ? "claude" : "terminal",
      sessionId: pane.claudeSession ?? null,
      status: "closed",
      snapshot: safeSnapshot(pane),
      updatedAt: at,
    })
    .catch(() => {});
}

export const searchThreads = (query: string, limit = 50) => db.search(query, limit).catch(() => []);
export const historyThreads = (limit = 200) => db.threads(limit).catch(() => []);
