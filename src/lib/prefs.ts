/** Switches and sizes for the thread-handling features (Settings → Threads & keys), kept in ui.json. */

export interface ThreadPrefs {
  /** Undo toast and ⌘Z after close, settle and snooze. */
  undo: boolean;
  undoSeconds: number;
  /** ⌘⇧T reopens the last closed thread. */
  reopen: boolean;
  /** Middle-click a thread row to close it. */
  middleClick: boolean;
  /** Pinned threads. */
  pin: boolean;
  /** ↑ ↓ Enter, F2 and ⇧F10 in the thread list. */
  sidebarKeys: boolean;
  /** Drag threads between sections. */
  dragSections: boolean;
  /** Send and open a fresh composer. */
  background: boolean;
  /** Stash the composer draft. */
  stash: boolean;
  /** Start a thread with no project. */
  noProject: boolean;
  /** Queue or Steer toggle while the agent runs. */
  steerKey: boolean;
  /** What Enter does with a message while the agent runs: wait for the turn to end, or interrupt it and send now. */
  followUp: "queue" | "steer";
  /** `>` in the palette shows only actions. */
  paletteActions: boolean;
  /** Copy PR link and number. */
  prCopy: boolean;
  /** Regenerate a thread title. */
  regenTitle: boolean;
  /** aurelia://new links. */
  promptLinks: boolean;
  /** Drop files onto a thread row. */
  dropFiles: boolean;
  /** ⌘[ and ⌘] between threads. */
  backForward: boolean;
  /** One faint jellyfish per live thread on the start screen. */
  bloom: boolean;
}

export const DEFAULT_PREFS: ThreadPrefs = {
  undo: true,
  undoSeconds: 5,
  reopen: true,
  middleClick: true,
  pin: true,
  sidebarKeys: true,
  dragSections: true,
  background: true,
  stash: true,
  noProject: true,
  steerKey: true,
  followUp: "queue",
  paletteActions: true,
  prCopy: true,
  regenTitle: true,
  promptLinks: true,
  dropFiles: true,
  backForward: true,
  bloom: false,
};

export const UNDO_SECONDS = { min: 2, max: 30 } as const;

/** A typed undo window, clamped to the allowed range; `fallback` when it isn't a number. */
export function clampUndoSeconds(raw: string | number, fallback: number): number {
  const n = typeof raw === "number" ? raw : raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.min(UNDO_SECONDS.max, Math.max(UNDO_SECONDS.min, Math.round(n))) : fallback;
}

/** Saved prefs from an older or hand-edited file: keep known keys of the right type, default the rest. */
export function normalizePrefs(raw: unknown): ThreadPrefs {
  const out: ThreadPrefs = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_PREFS) as (keyof ThreadPrefs)[]) {
    if (k === "undoSeconds") {
      if (typeof r[k] === "number" && Number.isFinite(r[k])) out.undoSeconds = clampUndoSeconds(r[k] as number, DEFAULT_PREFS.undoSeconds);
    } else if (k === "followUp") {
      if (r[k] === "steer" || r[k] === "queue") out.followUp = r[k] as "steer" | "queue";
    } else if (typeof r[k] === "boolean") (out as unknown as Record<string, boolean>)[k] = r[k] as boolean;
  }
  return out;
}
