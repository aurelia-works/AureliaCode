import { useEffect, type MouseEvent } from "react";
import { useUi, type RailTab } from "../store/ui";
import { CloseIcon } from "./Icons";
import { ChangesPanel } from "./ChangesPanel";
import { DetailsPanel } from "./DetailsPanel";
import { QueueRail } from "./QueueRail";
import { NotesPanel } from "./planner/NotesPanel";
import { usePlanner } from "../store/planner";

const TABS: { tab: RailTab; label: string; title: string }[] = [
  { tab: "queue", label: "Queue", title: "Threads that need you, tasks and saved prompts" },
  { tab: "changes", label: "Changes", title: "The focused thread's changes: this turn, its branch, or uncommitted" },
  { tab: "details", label: "Details", title: "The focused thread's folder, branch, PR and usage" },
  { tab: "notes", label: "Notes", title: "Journal and scratchpad for the focused thread's project" },
];

/** Right column beside the threads: the queue, or the focused thread's changes and details. */
export function RightPanel() {
  const stored = useUi((s) => s.railTab);
  const notesOn = usePlanner((s) => s.data.switches.review);
  const tab = stored === "notes" && !notesOn ? "queue" : stored;
  const width = useUi((s) => s.railWidths[tab]);
  // Notices sit left of the column, so they follow its width.
  useEffect(() => {
    const root = document.documentElement.style;
    if (width && tab !== "changes") root.setProperty("--rail-w", `${width}px`);
    else root.removeProperty("--rail-w");
  }, [width, tab]);

  const drag = (e: MouseEvent) => {
    e.preventDefault();
    document.body.classList.add("resizing", "resizing-row");
    const move = (ev: globalThis.MouseEvent) => {
      const w = Math.round(Math.min(Math.max(240, window.innerWidth - ev.clientX), window.innerWidth * 0.6));
      const ui = useUi.getState();
      ui.set({ railWidths: { ...ui.railWidths, [tab]: w } });
    };
    const up = () => {
      document.body.classList.remove("resizing", "resizing-row");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const reset = () => {
    const ui = useUi.getState();
    const { [tab]: _, ...rest } = ui.railWidths;
    ui.set({ railWidths: rest });
  };

  return (
    <aside className={`rail rail-${tab}`} aria-label="Side panel" style={width ? { width } : undefined}>
      <div className="rail-grip" onMouseDown={drag} onDoubleClick={reset} title="Drag to resize · double-click for the default width" />
      <div className="rail-tabs" role="tablist" aria-label="Side panel">
        {TABS.filter((t) => t.tab !== "notes" || notesOn).map((t) => (
          <button key={t.tab} role="tab" aria-selected={tab === t.tab} className={tab === t.tab ? "on" : ""} title={t.title} onClick={() => useUi.getState().set({ railTab: t.tab })}>
            {t.label}
          </button>
        ))}
        <button className="rail-close" aria-label="Close side panel" title="Close side panel" onClick={() => useUi.getState().set({ agentPanelOpen: false })}>
          <CloseIcon width={12} height={12} />
        </button>
      </div>
      {tab === "queue" ? <QueueRail /> : tab === "changes" ? <ChangesPanel /> : tab === "notes" ? <NotesPanel /> : <DetailsPanel />}
    </aside>
  );
}
