import { useEffect, useMemo, useRef } from "react";
import { useChat } from "../lib/chat";
import { crewRuns, type CrewRun } from "../lib/crew";
import { openFile } from "../lib/openFile";
import { useLayout } from "../store/layout";
import { useUi } from "../store/ui";
import { AgentLogo } from "./AgentLogos";
import { CloseIcon } from "./Icons";

const STATE_WORD: Record<CrewRun["state"], string> = {
  running: "Working",
  background: "Started in the background",
  status: "Waiting for a status check",
  done: "Done",
  failed: "Failed",
};

function logoOf(run: CrewRun): string {
  return (run.provider ?? run.who).toLowerCase();
}

/**
 * A delegated run's task, progress and report. These runs execute in the MCP process and
 * only send progress notes and a final report back through the lead's tool calls, so there
 * is no separate conversation to show; child threads (aurelia_open_pane) open normally.
 */
export function WorkerSheet() {
  const target = useUi((s) => s.workerOpen);
  const items = useChat((s) => (target ? s.byPane[target.paneId]?.transcript.items : undefined));
  const run = useMemo(() => (target ? crewRuns(items ?? []).find((r) => r.key === target.key || r.requestKey === target.key) : undefined), [target, items]);
  const dir = useLayout((s) => (target ? s.panes[target.paneId]?.cwd : undefined));
  const close = () => useUi.getState().set({ workerOpen: null });
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const open = target !== null;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    restoreRef.current = previous instanceof HTMLElement ? previous : null;
    closeRef.current?.focus();
    return () => {
      const el = restoreRef.current;
      if (el && document.contains(el)) el.focus();
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !e.currentTarget.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !e.currentTarget.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!target) return null;
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal worker-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Delegated agent"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="modal-head">
          <div className="worker-title">
            <span className="worker-logo" aria-hidden>
              <AgentLogo logo={run ? logoOf(run) : "custom"} size={16} />
            </span>
            <div>
              <h2>{run?.who ?? "Delegated agent"}</h2>
              <p className="worker-sub">
                {run ? STATE_WORD[run.state] : "This run is no longer in the conversation"}
                {run?.id ? ` · ${run.id}` : ""}
              </p>
            </div>
          </div>
          <button ref={closeRef} className="icon-btn sm" title="Close" aria-label="Close delegated agent" onClick={close}>
            <CloseIcon width={11} height={11} />
          </button>
        </div>
        {run ? (
          <div className="worker-body">
            <p className="worker-task">{run.task ?? run.title ?? "No task recorded."}</p>
            <dl className="worker-meta">
              {run.model && (
                <>
                  <dt>Model</dt>
                  <dd>{run.model}</dd>
                </>
              )}
              <dt>Access</dt>
              <dd>{run.mode === "work" ? "May edit files and run commands" : "Read only"}</dd>
              {run.tools !== undefined && (
                <>
                  <dt>Tool calls</dt>
                  <dd>{run.tools}</dd>
                </>
              )}
              {run.secs !== undefined && (
                <>
                  <dt>Time</dt>
                  <dd>{run.secs}s</dd>
                </>
              )}
            </dl>
            {run.stopped && <p className="worker-note">Stopped: {run.stopped}</p>}
            {run.changed.length > 0 && (
              <div className="worker-files">
                <h3>Files it changed</h3>
                <ul>
                  {run.changed.map((f) => (
                    <li key={f}>
                      <button type="button" className="link-btn" onClick={() => void openFile(dir && !f.startsWith("/") ? `${dir}/${f}` : f)}>
                        {f}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {run.blocked.length > 0 && <p className="worker-blocked">Blocked: {run.blocked.join("; ")}</p>}
            {run.log.length > 1 && (
              <div className="worker-log">
                <h3>Progress</h3>
                <ol>
                  {run.log.map((e, i) => (
                    <li key={`${e.at}-${i}`} className={e.state}>
                      <span className="worker-log-time num">{new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                      <span className="worker-log-text">{e.text}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="worker-report">
              <h3>{run.state === "done" ? "Report" : "Latest progress"}</h3>
              <pre>{run.report ?? "No report yet. The lead checks this run with aurelia_delegation."}</pre>
            </div>
            <p className="worker-footnote">
              Delegated runs have no separate transcript. Their task, progress and report arrive through the lead's
              <code> aurelia_delegate</code> calls. Threads the lead opened with <code>aurelia_open_pane</code> appear in
              Crew as threads you can open.
            </p>
          </div>
        ) : (
          <div className="worker-body">
            <p className="hint">Open the lead thread and ask it for a status check; the crew list rebuilds from its tool calls.</p>
          </div>
        )}
        <div className="modal-foot actions">
          <button type="button" onClick={close}>
            Close
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              useLayout.getState().focusPane(target.paneId);
              close();
            }}
          >
            Open the lead thread
          </button>
        </div>
      </div>
    </div>
  );
}
