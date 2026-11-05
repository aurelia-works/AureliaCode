import { useEffect, useState } from "react";
import { clampUndoSeconds, UNDO_SECONDS, type ThreadPrefs } from "../../lib/prefs";
import { useUi } from "../../store/ui";

const SWITCHES: { key: Exclude<keyof ThreadPrefs, "undoSeconds" | "followUp" | "newModel" | "newEffort" | "fallback">; label: string; hint?: string }[] = [
  { key: "undo", label: "Undo after close, settle and snooze", hint: "A toast with Undo, and ⌘Z while it shows" },
  { key: "reopen", label: "Reopen closed thread (⇧⌘T)" },
  { key: "middleClick", label: "Middle-click a thread to close it" },
  { key: "pin", label: "Pinned threads" },
  { key: "sidebarKeys", label: "Thread list keys", hint: "↑ ↓ Enter, F2 rename, ⇧F10 menu" },
  { key: "dragSections", label: "Drag threads between sections" },
  { key: "background", label: "Start in background", hint: "Send and open a fresh composer" },
  { key: "stash", label: "Stash the composer draft" },
  { key: "noProject", label: "Threads without a project" },
  { key: "steerKey", label: "Queue or Steer while the agent runs" },
  { key: "paletteActions", label: "Palette: > shows only actions" },
  { key: "prCopy", label: "Copy PR link and number" },
  { key: "regenTitle", label: "Regenerate a thread's title" },
  { key: "promptLinks", label: "Prompt links (aurelia://new)" },
  { key: "dropFiles", label: "Drop files onto a thread" },
  { key: "backForward", label: "Back and forward between threads (⌘[ ⌘])" },
  { key: "navRight", label: "Thread list on the right", hint: "The chat stays in the middle" },
  { key: "paneBrief", label: "Status cards in grid panes", hint: "An empty pane in a grid shows its state and task instead of the big prompt" },
  { key: "jellyIcons", label: "Jellyfish state icons in the thread list", hint: "Off: the same status icons as everywhere else" },
  { key: "recedeWorking", label: "Quiet busy threads in the list", hint: "A thread that's working and isn't open goes grey, so the ones that need you stand out" },
  { key: "rowDiffStat", label: "Lines changed on thread rows", hint: "+added −removed against HEAD, next to the branch" },
  { key: "mergeModelEffort", label: "Model and effort in one picker", hint: "Off: separate model and effort buttons on the composer" },
  { key: "composerFold", label: "Fold composer controls when narrow", hint: "Under 620px wide, permissions, provider and style move into a … menu" },
  { key: "boardGridButton", label: "New grid button on the board", hint: "⌘G opens a grid tab either way" },
  { key: "cardTabLabel", label: "Tab number on board cards", hint: "Which tab each agent's pane is in" },
  { key: "oneHeader", label: "One header style for every thread", hint: "Grid panes show state, folder / thread and More, like the chat view. Off: the older chips and icon buttons" },
  { key: "briefFeed", label: "Recent steps on grid cards", hint: "The last few things each agent did, under its status" },
  { key: "signalsFolded", label: "Fold Signals on the board", hint: "One line with the count; click to open" },
  { key: "headerModeChip", label: "Branch, cost, mode and account chips in the thread header", hint: "The sidebar row and the composer already show them" },
  { key: "bloom", label: "Jellyfish on the start screen", hint: "One per live thread" },
];

/** Switches for the thread-handling features borrowed from T3 Code. Each applies at once; no Save needed. */
export function ThreadsSection() {
  const prefs = useUi((s) => s.prefs);
  // Typed freely, clamped to 2..30 when you leave the box.
  const [secs, setSecs] = useState(String(prefs.undoSeconds));
  useEffect(() => setSecs(String(prefs.undoSeconds)), [prefs.undoSeconds]);
  const set = (patch: Partial<ThreadPrefs>) => useUi.getState().set({ prefs: { ...prefs, ...patch } });
  return (
    <section className="set-group">
      <h3>Threads &amp; keys</h3>
      <p className="hint">Each switch hides a feature without removing it. Changes apply straight away.</p>
      {SWITCHES.map((s) => (
        <label key={s.key} className="field check">
          <input type="checkbox" checked={prefs[s.key] as boolean} onChange={(e) => set({ [s.key]: e.target.checked })} />
          <span>
            {s.label}
            {s.hint && <span className="hint inline"> · {s.hint}</span>}
          </span>
        </label>
      ))}
      <label className="field">
        <span>Undo window (seconds)</span>
        <input
          type="number"
          min={UNDO_SECONDS.min}
          max={UNDO_SECONDS.max}
          value={secs}
          onChange={(e) => setSecs(e.target.value)}
          onBlur={() => {
            const v = clampUndoSeconds(secs, prefs.undoSeconds);
            set({ undoSeconds: v });
            setSecs(String(v));
          }}
        />
      </label>
    </section>
  );
}
