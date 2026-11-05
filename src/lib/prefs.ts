/** Switches and sizes for the thread-handling features (Settings → Threads & keys), kept in ui.json. */

/** Which notices may reach you; permission prompts and errors always do. */
export interface AlertPrefs {
  finished: boolean;
  needs_input: boolean;
  context: boolean;
  cache: boolean;
  burn: boolean;
  limit: boolean;
}

export const DEFAULT_ALERTS: AlertPrefs = { finished: true, needs_input: true, context: true, cache: true, burn: true, limit: true };

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
  /** New threads' model and effort; "" follows the Auto effort settings. */
  newModel: string;
  newEffort: string;
  /** Where a thread goes when its account hits its limit (lib/fallback.ts); "" for none. */
  fallback: string;
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
  /** The thread list on the right of the window instead of the left. */
  navRight: boolean;
  /** Empty panes in a grid show a compact status card (state, task, what it waits on) instead of the big empty prompt. */
  paneBrief: boolean;
  /** Jellyfish as the thread list's state icons, instead of the one status icon set. */
  jellyIcons: boolean;
  /** Busy threads you aren't looking at go grey in the list (T3's recede rule). */
  recedeWorking: boolean;
  /** Lines added and removed on each thread row. */
  rowDiffStat: boolean;
  /** One picker for model and effort. */
  mergeModelEffort: boolean;
  /** A narrow composer folds permissions, provider and style into a "…" menu. */
  composerFold: boolean;
  /** A "New grid" button on the board (⌘G does the same). */
  boardGridButton: boolean;
  /** "Tab 2" on board cards. */
  cardTabLabel: boolean;
  /** Grid pane headers read like the chat header: state, folder / thread, More. */
  oneHeader: boolean;
  /** Grid cards list the thread's last few steps. */
  briefFeed: boolean;
  /** The board's Signals start folded to one line. */
  signalsFolded: boolean;
  /** Branch, cost, permission-mode and account chips in a chat's thread header (the sidebar row and composer show them; off leaves the title room). */
  headerModeChip: boolean;
  /** One faint jellyfish per live thread on the start screen. */
  bloom: boolean;
  /** Old AureliaSpace terminal panes (plain zsh, Codex, Gemini, custom agents, teams). Off: chat only. */
  legacyTerminals: boolean;
  /** New tabs show the old Start screen (skills, briefing, resume list). Off: they open as a chat. */
  startScreen: boolean;
  /** Full Disk Access toast opens the drag-into-Settings sheet; off: it only opens System Settings. */
  permissionDrag: boolean;
  /** Review page: several reviewers score the diff and only findings two agree on lead (lib/council.ts). */
  council: boolean;
  /** OpenCode model ids for the council, comma-separated; "" runs the subagent model twice. */
  councilModels: string;
  /** Review rounds on one diff before the page asks you to stop (0: no cap). */
  reviewRoundCap: number;
  /** Once a night while the app is open, the council reviews one folder of each open repo's existing code. */
  nightlyReview: boolean;
  /** Local hour (0-23) the nightly review runs after. */
  nightlyHour: number;
  /** Council score a thread needs to count as Ready. */
  readyScore: number;
  /** Low / Medium / High from what the change touches, on the review page. */
  riskBadge: boolean;
  /** "Explain" on the review page: what is changing, why, where the risk is. */
  explainDiff: boolean;
  /** A Ready group in the thread list: finished threads with proof (a passing check or council). */
  readyGroup: boolean;
  /** Grid cards say what proves a finished thread works, or that nothing does yet. */
  proofLine: boolean;
  /** A thread whose diff more than doubles since it started moves to Needs you. */
  diffTripwire: boolean;
  /** "Revert PR" on a thread whose PR is merged. */
  revertAction: boolean;
  /** "Scrap and start over" in the thread menu. */
  scrapAction: boolean;
  /** Grid cards show what the thread has cost so far. */
  threadCost: boolean;
  /** The Work board shows a project's human time per PR (approvals, comments, wait, reverts). */
  humanStats: boolean;
  /** Sub-agent calls show the prompt they were given (chat tool card, and a hover on the grid feed). */
  agentPrompts: boolean;
  /** Cards say which thread started this one, and how many it started. */
  threadFamily: boolean;
  /** "Add to merge queue" on threads with an open PR: rebase, checks, reviewer PASS, then squash-merge, one at a time. Off by default: it merges code. */
  mergeQueue: boolean;
  /** "Start dev server" in the thread menu: the repo's dev script on a free port, opened next to the thread. */
  devServer: boolean;
  /** "Share read-only link" in a chat thread's menu (needs Remote on). */
  shareLink: boolean;
  alerts: AlertPrefs;
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
  newModel: "",
  newEffort: "",
  fallback: "",
  paletteActions: true,
  prCopy: true,
  regenTitle: true,
  promptLinks: true,
  dropFiles: true,
  backForward: true,
  navRight: false,
  paneBrief: true,
  jellyIcons: false,
  recedeWorking: true,
  rowDiffStat: true,
  mergeModelEffort: true,
  composerFold: true,
  boardGridButton: false,
  cardTabLabel: false,
  oneHeader: true,
  briefFeed: true,
  signalsFolded: true,
  headerModeChip: false,
  bloom: false,
  legacyTerminals: false,
  startScreen: false,
  permissionDrag: true,
  council: true,
  councilModels: "",
  reviewRoundCap: 3,
  nightlyReview: false,
  nightlyHour: 3,
  readyScore: 8,
  riskBadge: true,
  explainDiff: true,
  readyGroup: true,
  proofLine: true,
  diffTripwire: true,
  revertAction: true,
  scrapAction: true,
  threadCost: true,
  humanStats: true,
  agentPrompts: true,
  threadFamily: true,
  mergeQueue: false,
  devServer: true,
  shareLink: true,
  alerts: DEFAULT_ALERTS,
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
    } else if (k === "alerts") {
      const a = (r.alerts && typeof r.alerts === "object" ? r.alerts : {}) as Record<string, unknown>;
      out.alerts = Object.fromEntries((Object.keys(DEFAULT_ALERTS) as (keyof AlertPrefs)[]).map((n) => [n, typeof a[n] === "boolean" ? a[n] : true])) as unknown as AlertPrefs;
    } else if (k === "followUp") {
      if (r[k] === "steer" || r[k] === "queue") out.followUp = r[k] as "steer" | "queue";
    } else if (k === "nightlyHour") {
      const n = r[k];
      if (typeof n === "number" && Number.isFinite(n)) out[k] = Math.min(23, Math.max(0, Math.round(n)));
    } else if (k === "reviewRoundCap" || k === "readyScore") {
      const n = r[k];
      if (typeof n === "number" && Number.isFinite(n)) out[k] = Math.min(k === "readyScore" ? 10 : 20, Math.max(0, n));
    } else if (typeof DEFAULT_PREFS[k] === "string") {
      if (typeof r[k] === "string") (out as unknown as Record<string, string>)[k] = r[k] as string;
    } else if (typeof r[k] === "boolean") (out as unknown as Record<string, boolean>)[k] = r[k] as boolean;
  }
  return out;
}
