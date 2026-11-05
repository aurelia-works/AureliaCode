import { useEffect, useState } from "react";
import { clampUndoSeconds, UNDO_SECONDS, type ThreadPrefs } from "../../lib/prefs";
import { runNightly } from "../../store/nightly";
import { useUi } from "../../store/ui";

type Switch = { key: Exclude<keyof ThreadPrefs, "undoSeconds" | "followUp" | "newModel" | "newEffort" | "fallback" | "councilModels" | "reviewRoundCap" | "readyScore" | "nightlyHour">; label: string; hint?: string };

/** From Theo Browne's 2026-11-04 stream: review councils, proof before done, and cheap ways out. */
const REVIEW_SWITCHES: Switch[] = [
  { key: "council", label: "Council review", hint: "Review page: two or three cheap reviewers score the diff; findings a second one confirms lead" },
  { key: "riskBadge", label: "Risk badge on the review page", hint: "Low / Medium / High from what the change touches" },
  { key: "explainDiff", label: "Explain button", hint: "What is changing, why, where the risk is" },
  { key: "readyGroup", label: "Ready group in the thread list", hint: "Finished threads with a passing check or council score" },
  { key: "proofLine", label: "Proof line on grid cards" },
  { key: "diffTripwire", label: "Diff-growth tripwire", hint: "A thread whose diff more than doubles moves to Needs you" },
  { key: "revertAction", label: "Revert a merged PR from the thread menu" },
  { key: "scrapAction", label: "Scrap and start over in the thread menu" },
  { key: "threadCost", label: "Thread cost on grid cards" },
  { key: "humanStats", label: "Human time on the Work board", hint: "Pick a project: approvals, comments and wait per PR, people and bots apart, with reverts and incidents" },
  { key: "nightlyReview", label: "Nightly review of old code", hint: "Off by default: it spends OpenCode credits while you sleep" },
  { key: "agentPrompts", label: "Show sub-agent prompts", hint: "What each sub-agent was told, in the chat and on the grid feed" },
  { key: "threadFamily", label: "Thread family on cards", hint: "Which thread started this one, and how many it started" },
  { key: "mergeQueue", label: "Merge queue", hint: "Thread menu → Add to merge queue: rebase, wait for checks and a reviewer PASS for that commit, then squash-merge, one PR at a time" },
];

const SWITCHES: Switch[] = [
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

      <h3>Review &amp; ready</h3>
      {REVIEW_SWITCHES.map((s) => (
        <label key={s.key} className="field check">
          <input type="checkbox" checked={prefs[s.key] as boolean} onChange={(e) => set({ [s.key]: e.target.checked })} />
          <span>
            {s.label}
            {s.hint && <span className="hint inline"> · {s.hint}</span>}
          </span>
        </label>
      ))}
      <label className="field">
        <span>Council models</span>
        <input
          type="text"
          defaultValue={prefs.councilModels}
          placeholder="Blank: the subagent model, twice"
          aria-label="Council models, comma-separated OpenCode model ids"
          onBlur={(e) => set({ councilModels: e.target.value.trim() })}
        />
      </label>
      <p className="hint">Up to three OpenCode model ids, comma-separated (for example <code>opencode-go/deepseek-v4.1-flash, opencode-go/kimi-k2</code>). Opus is refused. Reviews never use Claude limits.</p>
      <label className="field">
        <span>Ready at council score</span>
        <input type="number" min={0} max={10} step={0.5} value={prefs.readyScore} onChange={(e) => e.target.value !== "" && set({ readyScore: Math.min(10, Math.max(0, Number(e.target.value))) })} />
      </label>
      <label className="field">
        <span>Review rounds before the cap</span>
        <input type="number" min={0} max={20} value={prefs.reviewRoundCap} onChange={(e) => e.target.value !== "" && set({ reviewRoundCap: Math.min(20, Math.max(0, Math.round(Number(e.target.value)))) })} />
      </label>
      <p className="hint">0 means no cap. Past the cap the review page says so and suggests stopping or scrapping instead of another round.</p>
      <label className="field">
        <span>Runs after (hour, 0-23)</span>
        <input type="number" min={0} max={23} value={prefs.nightlyHour} onChange={(e) => e.target.value !== "" && set({ nightlyHour: Math.min(23, Math.max(0, Math.round(Number(e.target.value)))) })} />
      </label>
      <p className="hint">While the app is open, the council reviews one folder of each open repo's existing code once a night (up to 3 repos), taking folders in turn. Important findings two reviewers agree on show on the Board under Found overnight. Uses the council models above, never Claude limits. <button type="button" className="link-btn" onClick={() => void runNightly()}>Run it now</button></p>
    </section>
  );
}
