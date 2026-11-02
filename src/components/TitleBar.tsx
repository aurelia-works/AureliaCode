import { basename } from "../lib/format";
import { useUi } from "../store/ui";
import { AureliaMark, SidebarIcon } from "./Icons";
import { UsageStrip } from "./UsageStrip";
import { NoticeBell } from "./Notices";
import { FocusChip } from "./planner/FocusChip";

/** A pane's short title: the command running in it, else its folder. */
export function paneTitle(cwd: string | undefined, running: string | undefined): string {
  if (running) return running.split(/\s+/)[0];
  return basename(cwd) || "~";
}

export function TitleBar() {
  const nav = useUi((s) => s.nav);
  const ui = useUi.getState();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <button
        className={`icon-btn quiet${nav ? " on" : ""}`}
        title="Sidebar (⌘\\)"
        aria-label="Sidebar"
        aria-pressed={!!nav}
        onClick={() => ui.set({ nav: nav ? null : "projects" })}
      >
        <SidebarIcon />
      </button>
      <div className="brand" data-tauri-drag-region>
        <AureliaMark className="brand-mark" width={20} height={20} />
        <span className="brand-name" data-tauri-drag-region>
          Aurelia<span>Space</span>
        </span>
        <DevMark />
      </div>
      <span className="tb-sp" data-tauri-drag-region />
      <ModeSwitch />
      <FocusChip />
      <NoticeBell />
      <FontReset />
      <UsageStrip />
    </header>
  );
}

/** Agents / Terminals / Review / Work: the same four views the ⇧⌘1–4 shortcuts pick. */
function ModeSwitch() {
  const mode = useUi((s) => s.mode);
  const reviewOpen = useUi((s) => s.reviewOpen);
  const set = useUi.getState().set;
  const pick = (next: "agents" | "work" | "terminals") => set({ mode: next, reviewOpen: false });
  return (
    <div className="mode-switch" role="group" aria-label="Mode">
      <button className={mode === "agents" ? "on" : ""} aria-pressed={mode === "agents"} title="Agents board (⇧⌘1)" onClick={() => pick("agents")}>
        Agents
      </button>
      <button className={mode === "terminals" ? "on" : ""} aria-pressed={mode === "terminals"} title="Terminals (⇧⌘2)" onClick={() => pick("terminals")}>
        Terminals
      </button>
      <button className={reviewOpen ? "on" : ""} aria-pressed={reviewOpen} title="Review changes (⇧⌘3)" onClick={() => set({ reviewOpen: true })}>
        Review
      </button>
      <button className={mode === "work" ? "on" : ""} aria-pressed={mode === "work"} title="Work board (⇧⌘4)" onClick={() => pick("work")}>
        Work
      </button>
    </div>
  );
}

/** Only shown when the font size is off its default; one click resets it. */
function FontReset() {
  const fontDelta = useUi((s) => s.fontDelta);
  if (fontDelta === 0) return null;
  return (
    <button className="tb-font num" title="Font size offset (⌘0 resets)" onClick={() => useUi.getState().set({ fontDelta: 0 })}>
      A{fontDelta > 0 ? `+${fontDelta}` : fontDelta}
    </button>
  );
}

/** "AureliaSpace Dev" (npm run app:build:dev) runs next to the installed app: a tilted DEV sash on the brand's corner says which one this is. */
function DevMark() {
  return import.meta.env.VITE_AURELIA_DEV ? (
    <span className="brand-dev" aria-label="Dev build">
      <span>DEV</span>
    </span>
  ) : null;
}
