import { useEffect, useState } from "react";
import { clampUndoSeconds, UNDO_SECONDS, type ThreadPrefs } from "../../lib/prefs";
import { useUi } from "../../store/ui";

const SWITCHES: { key: Exclude<keyof ThreadPrefs, "undoSeconds" | "followUp">; label: string; hint?: string }[] = [
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
