import { useMemo, useState } from "react";
import { useNow } from "../lib/cache";
import { basename } from "../lib/format";
import { ipc } from "../lib/ipc";
import { canTransition, groupBoard, type WorkItem, type WorkStatus } from "../lib/work";
import { focusedPaneId, useLayout } from "../store/layout";
import { useWork } from "../store/work";
import { useUi } from "../store/ui";
import { HumanTime } from "./HumanTime";
import { BranchIcon, PrIcon, SparkIcon } from "./Icons";

const DRAG_TYPE = "application/x-aurelia-work";

function ago(at: number, now: number): string {
  const m = Math.floor((now - at) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

const prTone = (state: string) => (state === "MERGED" ? "merged" : state === "CLOSED" ? "closed" : "");

function Card({
  item,
  now,
  onStart,
  onReview,
  dnd,
}: {
  item: WorkItem;
  now: number;
  onStart?: (item: WorkItem) => void;
  onReview?: (item: WorkItem) => void;
  dnd: { start(): void; end(): void; dragging: boolean };
}) {
  const showStart = item.status === "pending" && !!onStart;
  const showReview = (item.status === "working" || item.status === "review") && !!onReview;
  return (
    <article
      className={`wk-card ${item.status}${dnd.dragging ? " dragging" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, item.id);
        e.dataTransfer.effectAllowed = "move";
        dnd.start();
      }}
      onDragEnd={dnd.end}
      aria-label={`${item.title} (${item.status})`}
    >
      <header className="wk-card-head">
        <span className="wk-title" title={item.title}>
          {item.title}
        </span>
        <span className="wk-project" title={item.project}>
          {basename(item.project) || "~"}
        </span>
      </header>
      {item.description && <p className="wk-desc">{item.description}</p>}
      {(item.harness || item.model || item.effort || item.branch || item.pr) && (
        <div className="wk-badges">
          {item.harness && (
            <span className={`wk-badge harness ${item.harness}`} title={`Harness: ${item.harness}`}>
              {item.harness}
            </span>
          )}
          {item.model && (
            <span className="wk-badge model" title={`Model: ${item.model}`}>
              {item.model}
            </span>
          )}
          {item.effort && <span className="wk-badge quiet">{item.effort}</span>}
          {item.branch && (
            <span className="wk-badge branch" title={`Branch: ${item.branch}`}>
              <BranchIcon width={10} height={10} />
              {item.branch}
            </span>
          )}
          {item.pr && (
            <button
              className={`wk-badge pr ${prTone(item.pr.state)}`}
              title={`PR #${item.pr.number} (${item.pr.state.toLowerCase()}): open on GitHub`}
              onClick={() => void ipc.openUrl(item.pr!.url)}
            >
              <PrIcon width={10} height={10} />#{item.pr.number}
            </button>
          )}
        </div>
      )}
      <footer className="wk-card-foot">
        <span className="wk-meta num">
          {item.worktree ? "worktree" : item.paneId ? "thread" : item.cardId ? "card" : ""}
        </span>
        <span className="wk-age num" title={new Date(item.updatedAt).toLocaleString()}>
          {ago(item.updatedAt, now)}
        </span>
        {showStart && (
          <button className="btn primary wk-act" onClick={() => onStart?.(item)} title="Start this work in a thread">
            <SparkIcon width={11} height={11} /> Start
          </button>
        )}
        {showReview && (
          <button className="btn wk-act" onClick={() => onReview?.(item)} title="Open the changes to review">
            Review
          </button>
        )}
      </footer>
    </article>
  );
}

/**
 * Work mode (⇧⌘4): the durable work graph across every project — pending, in progress,
 * review, done — with the thread, worktree and PR each item is attached to. Dragging a
 * card between columns is the same validated transition the store uses.
 */
export function WorkBoard({
  onStart,
  onReview,
}: {
  onStart?: (item: WorkItem) => void;
  onReview?: (item: WorkItem) => void;
}) {
  const items = useWork((s) => s.items);
  const loadError = useWork((s) => s.loadError);
  const setStatus = useWork((s) => s.setStatus);
  const [project, setProject] = useState("all");
  const [drag, setDrag] = useState<{ id: string; over: WorkStatus | null } | null>(null);
  const [draft, setDraft] = useState("");
  const now = useNow();
  const statsOn = useUi((s) => s.prefs.humanStats);

  const projects = useMemo(() => [...new Set(items.map((i) => i.project))].sort(), [items]);
  const shown = useMemo(() => (project === "all" ? items : items.filter((i) => i.project === project)), [items, project]);
  const columns = groupBoard(shown);
  const dragged = drag ? items.find((i) => i.id === drag.id) : undefined;
  const reviewCount = shown.filter((i) => i.status === "review").length;

  const canDrop = (status: WorkStatus) => !!dragged && canTransition(dragged.status, status);
  const drop = (status: WorkStatus) => {
    if (dragged && canDrop(status)) setStatus(dragged.id, status);
    setDrag(null);
  };

  return (
    <div className="board workboard" aria-label="Work board">
      <header className="board-head">
        <div className="board-title">
          <h1>Work</h1>
          <span className="board-sub">
            {shown.length} item{shown.length === 1 ? "" : "s"} across {projects.length} project{projects.length === 1 ? "" : "s"}
            {reviewCount ? ` · ${reviewCount} to review` : ""}
          </span>
        </div>
        <div className="board-actions">
          <form
            className="wb-new"
            onSubmit={(e) => {
              e.preventDefault();
              const title = draft.trim();
              if (!title) return;
              const from = focusedPaneId();
              const cwd = useLayout.getState().panes[from ?? ""]?.cwd;
              useWork.getState().add({ title, project: project === "all" ? cwd || "~" : project });
              setDraft("");
            }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New work…" aria-label="New work" spellCheck={false} />
            <button type="submit" className="btn" disabled={!draft.trim()}>
              Add
            </button>
          </form>
          <select className="wb-filter" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project">
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {basename(p) || p}
              </option>
            ))}
          </select>
        </div>
      </header>
      {statsOn && project !== "all" && <HumanTime cwd={project} />}
      {loadError && <p className="hint err wk-load-error">{loadError}</p>}
      {items.length === 0 ? (
        <div className="board-empty">
          <SparkIcon width={28} height={28} />
          <h2>No work yet</h2>
          <p>Tasks from a project, roadmap cards and threads you start all land here, across every project.</p>
        </div>
      ) : (
        <div className="wk-scroll">
          {columns.map((col) => (
            <section
              key={col.status}
              className={`wk-col ${col.status}${drag?.over === col.status ? " over" : ""}${dragged && !canDrop(col.status) ? " no-drop" : ""}`}
              aria-label={col.title}
              onDragOver={(e) => {
                if (!canDrop(col.status)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (drag?.over !== col.status) setDrag(drag ? { ...drag, over: col.status } : null);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (drag?.over === col.status) setDrag({ ...drag, over: null });
              }}
              onDrop={(e) => {
                if (!canDrop(col.status)) return;
                e.preventDefault();
                drop(col.status);
              }}
            >
              <h2 className="wk-col-head">
                <span>{col.title}</span>
                <span className="wk-count num">{col.items.length}</span>
              </h2>
              <div className="wk-col-list">
                {col.items.map((item) => (
                  <Card
                    key={item.id}
                    item={item}
                    now={now}
                    onStart={onStart}
                    onReview={onReview}
                    dnd={{ start: () => setDrag({ id: item.id, over: null }), end: () => setDrag(null), dragging: drag?.id === item.id }}
                  />
                ))}
                {col.items.length === 0 && <p className="wk-empty">{drag ? "Drop here" : "Nothing here"}</p>}
              </div>
            </section>
          ))}
        </div>
      )}
      <footer className="board-keys" aria-hidden>
        <span>
          <kbd>drag</kbd> move between columns
        </span>
        <span>Pending → In progress → Review → Done</span>
      </footer>
    </div>
  );
}
