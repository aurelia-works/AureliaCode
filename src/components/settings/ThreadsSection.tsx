import { useEffect, useState } from "react";
import { clampUndoSeconds, UNDO_SECONDS, type ThreadPrefs } from "../../lib/prefs";
import { runNightly } from "../../store/nightly";
import { useUi } from "../../store/ui";

type BoolPref = { [K in keyof ThreadPrefs]: ThreadPrefs[K] extends boolean ? K : never }[keyof ThreadPrefs];
export type Switch = { key: BoolPref; label: string; hint?: string };

/** From Theo Browne's 2026-11-04 stream. Features that are always on (risk badge, tripwire, revert…) have no switch. */
const REVIEW_SWITCHES: Switch[] = [
  { key: "council", label: "Council review", hint: "Review page: two or three cheap reviewers score the diff; findings a second one confirms lead" },
  { key: "humanStats", label: "Human time on the Work board", hint: "Pick a project: approvals, comments and wait per PR, people and bots apart, with reverts and incidents" },
  { key: "nightlyReview", label: "Nightly review of old code", hint: "Off by default: it spends OpenCode credits while you sleep" },
  { key: "mergeQueue", label: "Merge queue", hint: "Thread menu → Add to merge queue: rebase, wait for checks and a reviewer PASS for that commit, then squash-merge, one PR at a time" },
];

const SWITCHES: Switch[] = [
  { key: "navRight", label: "Thread list on the right", hint: "The chat stays in the middle" },
  { key: "paneBrief", label: "Status cards in grid panes", hint: "An empty pane in a grid shows its state and task instead of the big prompt" },
  { key: "briefFeed", label: "Recent steps on grid cards", hint: "The last few things each agent did, under its status" },
  { key: "boardGridButton", label: "New grid button on the board", hint: "⌘G opens a grid tab either way" },
  { key: "cardTabLabel", label: "Tab number on board cards", hint: "Which tab each agent's pane is in" },
  { key: "signalsFolded", label: "Fold Signals on the board", hint: "One line with the count; click to open" },
  { key: "inbox", label: "Background inbox in Alerts", hint: "Delegations, routines, the nightly review, PR babysits and team runs in one list" },
];

/** A row of switches over prefs; each applies at once. */
export function PrefSwitches({ items }: { items: Switch[] }) {
  const prefs = useUi((s) => s.prefs);
  return items.map((s) => (
    <label key={s.key} className="field check">
      <input type="checkbox" checked={prefs[s.key]} onChange={(e) => useUi.getState().set({ prefs: { ...useUi.getState().prefs, [s.key]: e.target.checked } })} />
      <span>
        {s.label}
        {s.hint && <span className="hint inline"> · {s.hint}</span>}
      </span>
    </label>
  ));
}

const setPrefs = (patch: Partial<ThreadPrefs>) => useUi.getState().set({ prefs: { ...useUi.getState().prefs, ...patch } });

/** Appearance → thread list and grid view switches. */
export function ThreadViewSection() {
  return (
    <section className="set-group">
      <h3>Threads &amp; grid</h3>
      <PrefSwitches items={SWITCHES} />
    </section>
  );
}

/** Advanced → the undo window, and what is always on. */
export function UndoSection() {
  const undoSeconds = useUi((s) => s.prefs.undoSeconds);
  // Typed freely, clamped to 2..30 when you leave the box.
  const [secs, setSecs] = useState(String(undoSeconds));
  useEffect(() => setSecs(String(undoSeconds)), [undoSeconds]);
  return (
    <section className="set-group">
      <h3>Undo &amp; always-on</h3>
      <label className="field">
        <span>Undo window (seconds)</span>
        <input
          type="number"
          min={UNDO_SECONDS.min}
          max={UNDO_SECONDS.max}
          value={secs}
          onChange={(e) => setSecs(e.target.value)}
          onBlur={() => {
            const v = clampUndoSeconds(secs, undoSeconds);
            setPrefs({ undoSeconds: v });
            setSecs(String(v));
          }}
        />
      </label>
      <p className="hint">How long a closed, settled or snoozed thread can be brought back. Undo, pins, ⇧⌘T, ⌘[ ⌘], drag between sections, stash, scratch threads and the rest are always on.</p>
    </section>
  );
}

/** Background → council review, ready score, round cap and the nightly review. */
export function ReviewSection() {
  const prefs = useUi((s) => s.prefs);
  const set = setPrefs;
  return (
    <section className="set-group">
      <h3>Review &amp; ready</h3>
      <PrefSwitches items={REVIEW_SWITCHES} />
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
