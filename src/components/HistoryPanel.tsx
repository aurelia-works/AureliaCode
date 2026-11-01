import { useEffect, useState } from "react";
import { basename } from "../lib/format";
import type { StoredThread } from "../lib/db";
import { historyThreads, searchThreads } from "../lib/threadStore";
import { shellQuote } from "../lib/launch";
import { queueInit, showPane } from "../lib/terminals";
import { useLayout, type PaneMeta } from "../store/layout";
import { useUi } from "../store/ui";

/**
 * Search the durable SQLite history (open and closed threads). A result reopens as a new
 * pane with the same folder, account and Claude session; the live layout is not changed.
 */
export function HistoryPanel() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<StoredThread[]>([]);
  const [loading, setLoading] = useState(true);
  const close = () => useUi.getState().set({ historyOpen: false });

  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      const run = query.trim() ? searchThreads(query.trim(), 50) : historyThreads(50);
      run.then(
        (list) => live && (setRows(list), setLoading(false)),
        () => live && (setRows([]), setLoading(false)),
      );
    }, 140);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal history-panel" role="dialog" aria-label="Thread history" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && close()}>
        <div className="modal-head">
          <h2>Thread history</h2>
          <button type="button" className="icon-btn" title="Close" onClick={close}>
            ×
          </button>
        </div>
        <input
          className="history-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles, folders, sessions…"
          autoFocus
          spellCheck={false}
        />
        <div className="history-rows">
          {loading && <p className="hint">Searching…</p>}
          {!loading && !rows.length && <p className="hint">{query ? `No thread matches “${query}”.` : "No history yet. Threads appear here after they open or close."}</p>}
          {rows.map((t) => (
            <button key={t.id} type="button" className="history-row" onClick={() => reopen(t)}>
              <span className="history-title">{t.title || "Untitled thread"}</span>
              <span className="history-meta">
                {basename(t.cwd ?? t.project ?? "") || "~"} · {t.harness ?? "terminal"} · {t.status ?? "open"}
                {t.updatedAt ? ` · ${new Date(t.updatedAt).toLocaleDateString()}` : ""}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function reopen(t: StoredThread) {
  const snap = (t.snapshot && typeof t.snapshot === "object" ? t.snapshot : {}) as Partial<PaneMeta>;
  const layout = useLayout.getState();
  if (layout.panes[t.id]) {
    useUi.getState().set({ historyOpen: false });
    showPane(t.id);
    return;
  }
  const id = layout.newTab({
    // Reuse the closed row's id: the live mirror then updates it instead of adding a duplicate.
    id: t.id,
    cwd: t.cwd ?? snap.cwd,
    account: snap.account,
    agent: snap.agent,
    mode: snap.mode,
    browserUrl: snap.browser?.url,
    customAgent: snap.customAgent,
    chatModel: snap.chatModel,
  });
  if (snap.claudeSession) {
    if (snap.mode === "chat") layout.updatePane(id, { claudeSession: snap.claudeSession, chatUsed: true });
    else queueInit(id, `claude --resume ${shellQuote(snap.claudeSession)}`);
  }
  useUi.getState().set({ historyOpen: false });
  showPane(id);
}
