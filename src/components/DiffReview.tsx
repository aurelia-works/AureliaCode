import { useEffect, useMemo, useState } from "react";
import { sendChat } from "../lib/chat";
import { parseDiff, type DiffFile, type DiffLine } from "../lib/diff";
import { basename } from "../lib/format";
import { changeRisk } from "../lib/changeRisk";
import { diffHash, mergeCouncil, nextRound, parseReport, roundCapped, type Council } from "../lib/council";
import { sameStat } from "../lib/proof";
import { ipc, type DiffStat, type ReviewResult } from "../lib/ipc";
import { focusTerminal, insertAtPrompt, writeToPane } from "../lib/terminals";
import { useAgents } from "../store/agents";
import { paneDir, useGit } from "../store/git";
import { focusedPaneId, useLayout } from "../store/layout";
import { resetCouncil, saveCouncil, useReviews } from "../store/reviews";
import { toast, useUi } from "../store/ui";

/** What/Why/Risk per diff, so reopening the page doesn't ask again for the same change. */
const explained = new Map<string, string>();

/** The council's findings: verified ones first; one-reviewer guesses and nits fold away. */
const TAG_LABEL: Record<Council["findings"][number]["tag"], string> = { important: "Important", delete: "Could delete", nit: "Nit", "pre-existing": "Pre-existing" };

function CouncilView({ council, seats, onNote, onJump }: { council: Council; seats: { model: string; seconds: number; failed: boolean; score?: number }[]; onNote: (text: string) => void; onJump: (file: string) => void }) {
  const [more, setMore] = useState(false);
  const [nits, setNits] = useState(false);
  const verified = council.findings.filter((f) => f.verified && (nits || f.tag !== "nit"));
  const single = council.findings.filter((f) => !f.verified && (nits || f.tag !== "nit"));
  const nitCount = council.findings.filter((f) => f.tag === "nit").length;
  const line = (f: Council["findings"][number], i: number) => (
    <li key={i} className={`council-finding ${f.tag}`}>
      <span className={`council-tag ${f.tag}`}>{TAG_LABEL[f.tag]}</span>
      {f.file && (
        <button type="button" className="link-btn mono" onClick={() => onJump(f.file!)} title={`Show ${f.file}`}>
          {basename(f.file)}
          {f.line ? `:${f.line}` : ""}
        </button>
      )}
      <span className="council-text">{f.text}</span>
      <span className="council-by">{f.verified ? `${f.by.length} reviewers` : "1 reviewer"}</span>
    </li>
  );
  const asNote = () =>
    onNote(
      "Council review, verified findings:\n" +
        (verified.map((f) => `- [${f.tag}] ${f.file ?? ""}${f.line ? `:${f.line}` : ""} ${f.text}`).join("\n") || "- none"),
    );
  return (
    <section className={`review-verdict council ${council.verdict ?? "none"}`} aria-label="Council review">
      <header>
        <b className="num">{council.score !== undefined ? `${council.score}/10` : "No score"}</b>
        <span>{council.verdict ? `Verdict: ${council.verdict}` : "No verdict"}</span>
        <span className="page-sub num">
          {seats.map((s) => `${s.model.split("/").pop() || "reviewer"} ${s.failed ? "failed" : s.score !== undefined ? `${s.score}` : "-"}`).join(" · ")}
        </span>
        <button type="button" className="link-btn" onClick={asNote}>
          add to note for Claude
        </button>
      </header>
      {council.reviewers < 2 && <p className="hint">Only one reviewer finished, so nothing could be verified.</p>}
      {verified.length > 0 ? <ul className="council-list">{verified.map(line)}</ul> : council.reviewers >= 2 && <p className="hint">No finding was confirmed by a second reviewer.</p>}
      <p className="council-folds">
        {single.length > 0 && (
          <button type="button" className="link-btn" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            {more ? "Hide" : "Show"} {single.length} seen by one reviewer
          </button>
        )}
        {nitCount > 0 && (
          <button type="button" className="link-btn" onClick={() => setNits((n) => !n)} aria-pressed={nits}>
            {nits ? "Hide" : "Show"} {nitCount} nit{nitCount === 1 ? "" : "s"}
          </button>
        )}
      </p>
      {more && <ul className="council-list unverified">{single.map(line)}</ul>}
    </section>
  );
}

interface Comment {
  path: string;
  line?: number;
  kind: DiffLine["kind"];
  code: string;
  text: string;
}

const keyOf = (path: string, i: number) => `${path}\0${i}`;

function composeMessage(comments: Comment[], note: string) {
  const parts = ["Review comments on the uncommitted changes. Please address each one:", ""];
  comments.forEach((c, i) => {
    const where = c.line ? `${c.path}:${c.line}` : c.path;
    const removed = c.kind === "del" ? " (removed line)" : "";
    parts.push(`${i + 1}. ${where}${removed}`);
    if (c.code.trim()) parts.push(`   > ${c.code.trim()}`);
    parts.push(...c.text.trim().split("\n").map((l) => `   ${l}`));
    parts.push("");
  });
  if (note.trim()) parts.push(note.trim());
  return parts.join("\n").trim();
}

function FileView({
  file,
  anchor,
  comments,
  editing,
  setEditing,
  saveComment,
}: {
  file: DiffFile;
  anchor: string;
  comments: Record<string, Comment>;
  editing: string | null;
  setEditing: (k: string | null) => void;
  saveComment: (k: string, c: Comment | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const startEdit = (k: string) => {
    setDraft(comments[k]?.text ?? "");
    setEditing(k);
  };

  return (
    <section className="diff-file" id={anchor}>
      <header onClick={() => setOpen(!open)}>
        <span className={`chev${open ? " open" : ""}`} aria-hidden>›</span>
        <span className={`diff-status ${file.status}`}>{file.status[0].toUpperCase()}</span>
        <span className="diff-path">{file.path}</span>
        <span className="diff-counts">
          <span className="add">+{file.adds}</span> <span className="del">−{file.dels}</span>
        </span>
        <button
          className="link-btn"
          onClick={(e) => {
            e.stopPropagation();
            startEdit(keyOf(file.path, -1));
          }}
        >
          comment on file
        </button>
      </header>
      {open && (
        <div className="diff-lines">
          {file.binary && <div className="diff-note">Binary file</div>}
          {[{ kind: "hunk", text: "" } as DiffLine, ...file.lines].map((l, idx) => {
            const i = idx - 1; // -1 is the file-level comment slot
            const k = keyOf(file.path, i);
            const c = comments[k];
            const row =
              i < 0 ? null : l.kind === "hunk" ? (
                <div className="diff-line hunk">{l.text ? `@@ ${l.text}` : "@@"}</div>
              ) : (
                <div className={`diff-line ${l.kind}${c ? " commented" : ""}`} onClick={() => startEdit(k)}>
                  <span className="ln">{l.line}</span>
                  <span className="sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                  <span className="code">{l.text || " "}</span>
                  <span className="add-comment">+</span>
                </div>
              );
            return (
              <div key={idx}>
                {row}
                {editing === k ? (
                  <div className="diff-comment-edit">
                    <textarea
                      autoFocus
                      value={draft}
                      placeholder="What should Claude change here?  ⌘↵ save · Esc cancel"
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.metaKey) {
                          saveComment(k, draft.trim() ? { path: file.path, line: i < 0 ? undefined : l.line, kind: l.kind, code: i < 0 ? "" : l.text, text: draft } : null);
                          setEditing(null);
                        } else if (e.key === "Escape") {
                          e.stopPropagation();
                          setEditing(null);
                        }
                      }}
                    />
                    <div className="diff-comment-actions">
                      {c && (
                        <button
                          className="link-btn danger"
                          onClick={() => {
                            saveComment(k, null);
                            setEditing(null);
                          }}
                        >
                          delete
                        </button>
                      )}
                      <button onClick={() => setEditing(null)}>Cancel</button>
                      <button
                        className="primary"
                        onClick={() => {
                          saveComment(k, draft.trim() ? { path: file.path, line: i < 0 ? undefined : l.line, kind: l.kind, code: i < 0 ? "" : l.text, text: draft } : null);
                          setEditing(null);
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  c && (
                    <div className="diff-comment" onClick={() => startEdit(k)}>
                      {c.text}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Review mode (⇧⌘R / ⇧⌘3): uncommitted changes as a page, line comments sent to a Claude pane. */
export function DiffReview() {
  const open = useUi((s) => s.reviewOpen);
  const sessions = useAgents((s) => s.sessions);
  const gitInfo = useGit((s) => s.info);
  const [state, setState] = useState<{ root: string; files: DiffFile[]; truncated: boolean; hash: string } | { error: string } | null>(null);
  /** The repo's diffstat now, to tell whether a council result is about this diff. */
  const [nowStat, setNowStat] = useState<DiffStat | null>(null);
  const [comments, setComments] = useState<Record<string, Comment>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [target, setTarget] = useState<string>("");
  const [review, setReview] = useState<ReviewResult | { error: string } | "running" | null>(null);
  const [councilState, setCouncilState] = useState<"running" | { error: string } | null>(null);
  const [explain, setExplain] = useState<string | { error: string } | "running" | null>(null);
  const prefs = useUi((s) => s.prefs);

  const load = () => {
    const pane = focusedPaneId();
    const dir = pane ? paneDir(pane) : undefined;
    setComments({}); // comments are keyed by line index; a reload can shift lines
    setEditing(null);
    setReview(null);
    setCouncilState(null);
    setExplain(null);
    if (!dir) return setState({ error: "The focused pane has no working directory yet." });
    setState(null);
    ipc.gitDiffstat(dir).then(setNowStat, () => setNowStat(null));
    ipc.gitDiff(dir).then(
      (d) => setState({ root: d.root, files: parseDiff(d.diff), truncated: d.truncated, hash: diffHash(d.diff) }),
      (e) => setState({ error: String(e) }),
    );
  };

  useEffect(() => {
    if (!open) return;
    setComments({});
    setEditing(null);
    setNote("");
    load();
  }, [open]);

  const root = state && "root" in state ? state.root : undefined;
  // A "starting" session is still a shell prompt: pasting + Enter there would run the text as commands.
  const agents = useMemo(() => Object.values(sessions).filter((a) => a.status !== "starting"), [sessions]);

  // Default target: the focused pane if it's an agent, else an agent in the same repo.
  useEffect(() => {
    if (!open) return;
    const focused = focusedPaneId();
    if (focused && sessions[focused] && sessions[focused].status !== "starting") return setTarget(focused);
    const sameRepo = agents.find((a) => a.cwd && gitInfo[a.cwd]?.root === root);
    setTarget(sameRepo?.paneId ?? agents[0]?.paneId ?? "");
  }, [open, root]);

  const files = state && "files" in state ? state.files : [];
  const adds = files.reduce((n, f) => n + f.adds, 0);
  const dels = files.reduce((n, f) => n + f.dels, 0);
  const repoReview = useReviews((s) => (root ? s.byRoot[root] : undefined));
  const risk = useMemo(() => changeRisk(files.map((f) => f.path), adds, dels), [files, adds, dels]);
  if (!open) return null;
  const close = () => useUi.getState().set({ reviewOpen: false });
  const list = Object.values(comments);

  const send = () => {
    if (!target || (!list.length && !note.trim())) return;
    if (useLayout.getState().panes[target]?.mode === "chat") void sendChat(target, composeMessage(list, note));
    else {
      insertAtPrompt(target, composeMessage(list, note));
      // Let the bracketed paste land before submitting it.
      setTimeout(() => writeToPane(target, "\r"), 120);
    }
    close();
    useUi.getState().set({ mode: "terminals" });
    useLayout.getState().focusPane(target);
    requestAnimationFrame(() => focusTerminal(target));
    toast(`Sent ${list.length} comment${list.length === 1 ? "" : "s"} to Claude`);
  };

  const agentLabel = (paneId: string) => {
    const a = sessions[paneId];
    return `${a?.account ?? "claude"} · ${basename(a?.cwd) || "—"}`;
  };

  const commentsIn = (path: string) => list.filter((c) => c.path === path).length;

  const diffKey = `${root}|${state && "hash" in state ? state.hash : ""}`;
  const branch = root ? gitInfo[root]?.branch : undefined;
  // The round the next council would be; past the cap it says so instead of quietly running again.
  const capped = roundCapped(nextRound(repoReview, branch) - 1, prefs.reviewRoundCap);
  const stale = !!repoReview && !sameStat(repoReview.stat, nowStat);
  const jump = (file: string) => {
    const i = files.findIndex((f) => f.path === file || f.path.endsWith(`/${file}`) || file.endsWith(f.path));
    if (i >= 0) document.getElementById(`diff-${i}`)?.scrollIntoView({ block: "start" });
  };

  const runCouncil = () => {
    if (!root || councilState === "running") return;
    setCouncilState("running");
    const models = prefs.councilModels.split(",").map((m) => m.trim()).filter(Boolean);
    Promise.all([ipc.councilReview(root, models), ipc.gitDiffstat(root).catch(() => null)]).then(
      ([seats, stat]) => {
        const reports = seats.map((seat, i) => (seat.failed ? { reviewer: `${seat.model}#${i}`, findings: [], failed: true } : parseReport(seat.text, `${seat.model}#${i}`)));
        saveCouncil(root, {
          council: mergeCouncil(reports),
          seats: seats.map((seat, i) => ({ model: seat.model, seconds: seat.seconds, failed: seat.failed, score: reports[i].score })),
          at: Date.now(),
          stat,
          branch,
        });
        if (stat) setNowStat(stat);
        setCouncilState(null);
      },
      (e) => setCouncilState({ error: String(e) }),
    );
  };

  const runExplain = () => {
    if (!root || explain === "running") return;
    const cached = explained.get(diffKey);
    if (cached) return setExplain(cached);
    setExplain("running");
    ipc.explainChanges(root).then(
      (t) => {
        explained.set(diffKey, t);
        setExplain(t);
      },
      (e) => setExplain({ error: String(e) }),
    );
  };

  const runReview = () => {
    if (!root || review === "running") return;
    setReview("running");
    ipc.reviewChanges(root).then(setReview, (e) => setReview({ error: String(e) }));
  };

  return (
    <div
      className="page review-page"
      role="dialog"
      aria-label="Review changes"
      onKeyDown={(e) => e.key === "Escape" && !editing && close()}
      tabIndex={-1}
      ref={(el) => {
        if (el && !el.contains(document.activeElement)) el.focus();
      }}
    >
      <header className="page-head">
        <div className="page-title">
          <h1>Review</h1>
          {root && <span className="page-sub mono">{basename(root)}</span>}
          {files.length > 0 && (
            <span className="page-sub num">
              {files.length} file{files.length === 1 ? "" : "s"} · <span className="add">+{adds}</span> <span className="del">−{dels}</span>
            </span>
          )}
        </div>
        {files.length > 0 && (
          <span className={`risk-badge ${risk.level}`} title={risk.why.length ? risk.why.join("\n") : "Small change to ordinary files"}>
            {risk.level === "low" ? "Low risk" : risk.level === "medium" ? "Medium risk" : "High risk"}
          </span>
        )}
        <button className="btn" onClick={runExplain} disabled={!files.length || explain === "running"} title="What is changing, why, and where the risk is. A DeepSeek read; no Claude limits.">
          {explain === "running" ? "Explaining…" : "Explain"}
        </button>
        {prefs.council && (
          <button
            className="btn"
            onClick={runCouncil}
            disabled={!files.length || councilState === "running"}
            title={
              capped
                ? `${repoReview?.rounds} rounds on this change already (cap ${prefs.reviewRoundCap}). Another round rarely helps: stop, or scrap and restart.`
                : "Two or more cheap reviewers (OpenCode) score the change 1-10 and tag findings; only ones a second reviewer confirms lead. No Claude limits."
            }
          >
            {councilState === "running" ? "Council reviewing…" : capped ? `Round ${nextRound(repoReview, branch)}: past the cap` : nextRound(repoReview, branch) > 1 ? `Council round ${nextRound(repoReview, branch)}` : "Council review"}
          </button>
        )}
        {!prefs.council && <button
          className="btn"
          onClick={runReview}
          disabled={!files.length || review === "running"}
          title="A read-only DeepSeek agent (OpenCode Go) grades these changes against .aurelia/scorers/*.md, or the built-in scorers. Doesn't use Claude limits."
        >
          {review === "running" ? "Reviewing…" : "Review with DeepSeek"}
        </button>}
        <button className="btn" onClick={load}>
          Reload
        </button>
        <button className="btn" onClick={close}>
          Close <kbd>esc</kbd>
        </button>
      </header>
      <div className="review-layout">
        {files.length > 0 && (
          <nav className="review-index" aria-label="Changed files">
            <div className="label">Files</div>
            {files.map((f, i) => (
              <button key={f.path} className="review-index-row" onClick={() => document.getElementById(`diff-${i}`)?.scrollIntoView({ block: "start" })} title={f.path}>
                <span className={`diff-status ${f.status}`}>{f.status[0].toUpperCase()}</span>
                <span className="review-index-name">{basename(f.path)}</span>
                {commentsIn(f.path) > 0 && <span className="review-index-c num" title="Comments">{commentsIn(f.path)}</span>}
                <span className="diff-counts num">
                  <span className="add">+{f.adds}</span> <span className="del">−{f.dels}</span>
                </span>
              </button>
            ))}
          </nav>
        )}
        <div className="review-body">
          {!state && <p className="empty">Loading diff…</p>}
          {state && "error" in state && <p className="empty">{state.error}</p>}
          {state && "files" in state && state.files.length === 0 && <p className="empty">No uncommitted changes.</p>}
          {prefs.council && capped && councilState !== "running" && (
            <p className="hint warn">
              {repoReview?.rounds} council rounds on this branch (cap {prefs.reviewRoundCap}). If it isn't converging, stop here or scrap the thread and start over.{" "}
              <button type="button" className="link-btn" onClick={() => root && resetCouncil(root)}>
                Reset rounds
              </button>
            </p>
          )}
          {councilState === "running" && <p className="hint">The council is reading the changes… a minute or two.</p>}
          {councilState && typeof councilState === "object" && <p className="hint warn">{councilState.error}</p>}
          {prefs.council && repoReview && stale && <p className="hint warn">The diff changed since this council review; run it again for a score on this change.</p>}
          {prefs.council && repoReview && (
            <CouncilView council={repoReview.council} seats={repoReview.seats} onJump={jump} onNote={(t) => setNote((n) => (n ? `${n}\n\n` : "") + t)} />
          )}
          {explain === "running" && <p className="hint">Reading the change to explain it…</p>}
          {explain && typeof explain === "object" && <p className="hint warn">{explain.error}</p>}
          {typeof explain === "string" && explain !== "running" && (
            <section className="review-explain" aria-label="What this change does">
              <header>
                <b>Explained</b>
                <button className="link-btn" onClick={() => setExplain(null)}>
                  hide
                </button>
              </header>
              <div className="review-explain-text">{explain}</div>
            </section>
          )}
          {review === "running" && <p className="hint">DeepSeek is reading the changes… this takes a minute or two.</p>}
          {review && typeof review === "object" && "error" in review && <p className="hint warn">{review.error}</p>}
          {review && typeof review === "object" && "text" in review && (
            <section className={`review-verdict ${review.verdict ?? "none"}`}>
              <header>
                <b>{review.verdict ? `Verdict: ${review.verdict}` : review.failed ? "Review stopped" : "No verdict"}</b>
                <span className="page-sub">
                  {review.scorers.join(" · ")} · {Math.round(review.seconds)}s
                </span>
                <button className="link-btn" onClick={() => setNote((n) => (n ? `${n}\n\n` : "") + `DeepSeek review:\n${review.text}`)}>
                  add to note for Claude
                </button>
                <button className="link-btn" onClick={() => setReview(null)}>
                  hide
                </button>
              </header>
              <pre>{review.text}</pre>
            </section>
          )}
          {state && "files" in state && (
            <>
              {state.truncated && <p className="hint">Diff is large and was truncated.</p>}
              {state.files.map((f, i) => (
                <FileView
                  key={f.path}
                  file={f}
                  anchor={`diff-${i}`}
                  comments={comments}
                  editing={editing}
                  setEditing={setEditing}
                  saveComment={(k, c) =>
                    setComments((prev) => {
                      const next = { ...prev };
                      if (c) next[k] = c;
                      else delete next[k];
                      return next;
                    })
                  }
                />
              ))}
            </>
          )}
        </div>
      </div>
      <footer className="review-foot">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Overall note for Claude (optional)" rows={2} />
        <div className="review-send">
          <span className="msg">
            <b className="num">{list.length}</b> comment{list.length === 1 ? "" : "s"} · click any line to comment
          </span>
          {agents.length ? (
            <label className="review-target">
              <span>Send to</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {agents.map((a) => (
                  <option key={a.paneId} value={a.paneId}>
                    {agentLabel(a.paneId)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="hint inline">No Claude panes running</span>
          )}
          <button className="primary" onClick={send} disabled={!target || (!list.length && !note.trim())}>
            Send to Claude
          </button>
        </div>
      </footer>
    </div>
  );
}
