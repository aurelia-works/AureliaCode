import { useMemo } from "react";
import { useChat } from "../lib/chat";
import { crewRuns, sortCrew, type CrewRun } from "../lib/crew";
import { familyOf } from "../lib/threadFamily";
import { useLayout } from "../store/layout";
import { useUi } from "../store/ui";
import { AgentLogo } from "./AgentLogos";
import { StatusGlyph } from "./StatusGlyph";
import { useThreadSummary } from "./ThreadCard";

const STATE_WORD: Record<CrewRun["state"], string> = {
  running: "Working",
  background: "Background",
  status: "Waiting",
  done: "Done",
  failed: "Failed",
};

function runLogo(run: CrewRun): string {
  return (run.provider ?? run.who).toLowerCase();
}

/** One row per agent this lead handed work to: a delegated run, or a child thread it opened. */
export function CrewSection({ paneId }: { paneId?: string }) {
  const items = useChat((s) => (paneId ? s.byPane[paneId]?.transcript.items : undefined));
  const runs = useMemo(() => sortCrew(crewRuns(items ?? [])), [items]);
  // A primitive key: selecting the children array itself hands back a fresh array on every
  // store read, which makes Zustand's snapshot check loop.
  const childKey = useLayout((s) => (paneId ? familyOf(s.panes, paneId).children.join("\n") : ""));
  const children = useMemo(() => (childKey ? childKey.split("\n") : []), [childKey]);
  if (!paneId || (runs.length === 0 && children.length === 0)) return null;
  const active = runs.filter((r) => r.state === "running" || r.state === "background").length;
  return (
    <section className="crew" aria-label="Delegated agents">
      <h3>
        Crew
        <span className="n num">{runs.length + children.length}</span>
        {active > 0 && <span className="crew-live">{active} working</span>}
      </h3>
      {runs.map((run) => (
        <button
          key={run.key}
          type="button"
          className={`crew-row ${run.state}`}
          title={`${run.title ?? "Delegated run"}${run.model ? ` · ${run.model}` : ""}`}
          onClick={() => useUi.getState().set({ workerOpen: { paneId, key: run.key } })}
        >
          <span className="crew-logo" aria-hidden>
            <AgentLogo logo={runLogo(run)} size={13} />
          </span>
          <span className="crew-main">
            <span className="crew-title">{run.title ?? "Delegated run"}</span>
            <span className="crew-meta">
              {run.who}
              {run.model ? ` · ${run.model}` : ""}
            </span>
          </span>
          <span className={`crew-state ${run.state}`}>
            <i aria-hidden />
            {STATE_WORD[run.state]}
          </span>
        </button>
      ))}
      {children.map((id) => (
        <CrewPane key={id} paneId={id} />
      ))}
    </section>
  );
}

/** A thread the lead opened through `aurelia_open_pane`: it has its own conversation to open. */
function CrewPane({ paneId }: { paneId: string }) {
  const t = useThreadSummary(paneId);
  return (
    <button className={`crew-row pane ${t.v}`} title={`Open ${t.title}`} onClick={() => useLayout.getState().focusPane(paneId)}>
      <span className="crew-logo" aria-hidden>
        <StatusGlyph state={t.v} />
      </span>
      <span className="crew-main">
        <span className="crew-title">{t.title}</span>
        <span className="crew-meta">{t.detail}</span>
      </span>
      <span className={`crew-state ${t.v}`}>
        <i aria-hidden />
        Open
      </span>
    </button>
  );
}
