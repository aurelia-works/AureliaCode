import { useEffect, useMemo, useState } from "react";
import { ipc, type GitChange } from "../lib/ipc";

export type GitDialogMode = "commit" | "pr";

export interface GitDialogResult {
  text: string;
  error?: boolean;
}

/**
 * A real commit / pull-request dialog. WKWebView does not implement `window.prompt`, and a
 * commit should show exactly which files go in: this lists the working-tree changes and
 * selects everything except secret-looking paths. Nothing is staged until Commit.
 */
export function GitDialog({
  mode,
  dir,
  defaultTitle,
  onClose,
  onDone,
}: {
  mode: GitDialogMode;
  dir: string;
  defaultTitle?: string;
  onClose: () => void;
  onDone: (result: GitDialogResult) => void;
}) {
  const [changes, setChanges] = useState<GitChange[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState(defaultTitle ?? "AureliaCode changes");
  const [body, setBody] = useState("Created from AureliaCode.");
  const [draft, setDraft] = useState(true);
  const [push, setPush] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "commit") return;
    let live = true;
    ipc.gitChanges(dir).then(
      (list) => {
        if (!live) return;
        setChanges(list);
        setPicked(new Set(list.filter((c) => !secretLike(c.path)).map((c) => c.path)));
      },
      (e) => live && setLoadError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [dir, mode]);

  const selected = useMemo(() => changes?.filter((c) => picked.has(c.path)) ?? [], [changes, picked]);
  const skipped = useMemo(() => changes?.filter((c) => !picked.has(c.path) && secretLike(c.path)) ?? [], [changes, picked]);

  const toggle = (path: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const commit = async () => {
    if (!selected.length || !message.trim()) return;
    setBusy(true);
    try {
      // A rename needs both sides staged: the new path and the old deletion.
      const paths = selected.flatMap((c) => (c.oldPath ? [c.path, c.oldPath] : [c.path]));
      const sha = await ipc.gitCommit(dir, message.trim(), paths);
      if (!push) {
        onDone({ text: `Committed ${sha}` });
        return;
      }
      try {
        await ipc.gitPush(dir);
        onDone({ text: `Committed ${sha} and pushed` });
      } catch (e) {
        onDone({ text: `Committed ${sha}, but push failed: ${e}`, error: true });
      }
    } catch (e) {
      onDone({ text: String(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const createPr = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const pr = await ipc.gitCreatePr(dir, title.trim(), body, draft);
      onDone({ text: `Opened PR #${pr.number}` });
    } catch (e) {
      onDone({ text: String(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal git-dialog"
        role="dialog"
        aria-label={mode === "commit" ? "Commit changes" : "Open a pull request"}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="modal-head">
          <h2>{mode === "commit" ? "Commit changes" : "Open a pull request"}</h2>
          <button type="button" className="icon-btn" title="Close" onClick={onClose}>
            ×
          </button>
        </div>

        {mode === "commit" ? (
          <>
            {loadError && <p className="hint err">{loadError}</p>}
            {!changes && !loadError && <p className="hint">Reading the working tree…</p>}
            {changes?.length === 0 && <p className="hint">Nothing to commit.</p>}
            {!!changes?.length && (
              <>
                <div className="git-files" role="group" aria-label="Files to commit">
                  {changes.map((c) => (
                    <label key={c.path} className={`git-file${secretLike(c.path) ? " caution" : ""}`}>
                      <input type="checkbox" checked={picked.has(c.path)} onChange={() => toggle(c.path)} />
                      <span className={`git-status ${statusClass(c.status)}`}>{c.status}</span>
                      <span className="git-path" title={c.path}>
                        {c.path}
                      </span>
                      {c.untracked && <span className="git-tag">new</span>}
                      {secretLike(c.path) && <span className="git-tag warn">secret-like</span>}
                    </label>
                  ))}
                </div>
                {!!skipped.length && (
                  <p className="hint warn">
                    {skipped.length} secret-looking file{skipped.length === 1 ? "" : "s"} left unchecked. Select them only if you mean to commit them.
                  </p>
                )}
                <label className="field">
                  <span>Commit message</span>
                  <input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="What changed, and why"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void commit();
                    }}
                  />
                </label>
                <label className="field check">
                  <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} />
                  <span>Push the branch after committing</span>
                </label>
              </>
            )}
          </>
        ) : (
          <>
            <label className="field">
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>Body</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
            </label>
            <label className="field check">
              <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
              <span>Open as a draft</span>
            </label>
          </>
        )}

        <div className="modal-foot actions">
          <span className="sp" />
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {mode === "commit" ? (
            <button type="button" className="btn primary" disabled={busy || !selected.length || !message.trim()} onClick={() => void commit()}>
              {busy ? "Committing…" : `Commit ${selected.length || ""}`.trim()}
            </button>
          ) : (
            <button type="button" className="btn primary" disabled={busy || !title.trim()} onClick={() => void createPr()}>
              {busy ? "Opening…" : "Create PR"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Paths that usually hold credentials or machine noise: unchecked by default. */
export function secretLike(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  return (
    base === ".DS_Store" ||
    base === ".env" ||
    base.startsWith(".env.") ||
    /\.(pem|key|p12|pfx|crt|cer)$/i.test(base) ||
    /^id_(rsa|ed25519|ecdsa)(\.pub)?$/i.test(base)
  );
}

function statusClass(status: string): string {
  return status === "?" ? "new" : status === "D" ? "del" : status === "M" ? "mod" : status === "A" ? "add" : "";
}
