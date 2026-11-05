import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { useConfig } from "./config";
import { DEFAULT_PREFS, normalizePrefs, type ThreadPrefs } from "../lib/prefs";
import { startWorktree } from "../lib/threadTools";
import { setTerminalsAllowed } from "../lib/paneKind";
import { readSaved } from "../lib/savedState";

/** A task the account picker will hand to the new Claude pane as its first prompt. */
export interface PickerTask {
  project: string;
  id: string;
  title: string;
}

export type Mode = "agents" | "work" | "terminals";

/** What the right column shows: the queue, the focused thread's changes, or its details. */
export type RailTab = "queue" | "changes" | "details" | "notes";

/**
 * What the left navigator shows: the workspace tree (⌘\), the project's files (⇧⌘F),
 * search in them (⌥⌘F), their type errors (⇧⌘M), the focused Claude pane's conversation
 * as a readable thread (⌥⌘T), or nothing.
 */
export type NavView = "projects" | "files" | "search" | "problems" | "thread" | null;

interface UiState {
  /** Title-bar mode: agent board or the tab/pane view (Review is the diff modal). */
  mode: Mode;
  agentPanelOpen: boolean;
  railTab: RailTab;
  /** Right column widths you dragged, per tab (Changes is wider by default); unset = default. */
  railWidths: Partial<Record<RailTab, number>>;
  nav: NavView;
  /** One thread at a time: the stage shows only each tab's focused pane, full size. */
  single: boolean;
  /** The active tab's grid doesn't fit the stage, so it shows only the focused pane (App.tsx, lib/gridFit.ts). Not saved. */
  gridFolded: boolean;
  settingsOpen: boolean;
  /** Section to show when Settings next opens (then cleared). */
  settingsSection: string | null;
  /** Quick capture box (palette: "Capture…"). */
  captureOpen: boolean;
  /** Roadmap screen; `roadmapProject` is the planner project shown (null = all). */
  roadmapOpen: boolean;
  weeklyOpen: boolean;
  /** Switches for the thread-handling features (Settings → Threads & keys). */
  prefs: ThreadPrefs;
  /** Thread being renamed in the list (F2), and thread whose menu is open (right-click, ⇧F10). */
  renameThread: string | null;
  threadMenu: string | null;
  /** Composer drafts set aside with ⌘S (lib/stash.ts). */
  stash: string[];
  roadmapProject: string | null;
  /** ⌘P command palette. */
  paletteOpen: boolean;
  gridOpen: boolean;
  reviewOpen: boolean;
  /** Durable thread history search (SQLite). */
  historyOpen: boolean;
  /** The drag-the-app-into-System-Settings sheet (components/PermissionsSheet.tsx). */
  permissionsOpen: boolean;
  /** "split" | "tab" — where the account picker will open the new Claude pane. */
  accountPicker: null | { target: "split" | "tab"; task?: PickerTask };
  /** Give new Claude panes their own git worktree. */
  useWorktree: boolean;
  /** Tasks started from the picker get a read-only reviewer when their agent finishes. */
  reviewWhenDone: boolean;
  /** Claude panes from the agent picker and from other agents (aurelia_open_pane) open as chats. */
  claudeAsChat: boolean;
  toast: null | { text: string; error?: boolean; at: number };
  /** Pane whose command-suggestion bar is open. */
  suggestPaneId: string | null;
  /** Pane whose prompt composer (⌘L) is open. */
  composerPaneId: string | null;
  /** Text for that pane's composer to start from (a saved prompt or a prompt link), taken once. */
  composerDraft: { paneId: string; text: string } | null;
  /** A saved prompt with `{{fields}}` waiting to be filled in before it reaches the composer. */
  promptFill: { paneId: string; text: string } | null;
  /** Pane whose checkpoints dialog is open. */
  checkpointsPaneId: string | null;
  fontDelta: number;
  /** Set to Date.now() to play the title-bar greeting once (Settings → Appearance → Play it now). Not saved. */
  greetingPlayAt: number;
  windowFocused: boolean;

  set(patch: Partial<Omit<UiState, "set">>): void;
}

export const useUi = create<UiState>((set) => ({
  mode: "terminals",
  agentPanelOpen: false,
  railTab: "queue",
  railWidths: {},
  nav: "projects",
  single: true,
  gridFolded: false,
  settingsOpen: false,
  settingsSection: null,
  captureOpen: false,
  roadmapOpen: false,
  weeklyOpen: false,
  prefs: DEFAULT_PREFS,
  renameThread: null,
  threadMenu: null,
  stash: [],
  roadmapProject: null,
  paletteOpen: false,
  gridOpen: false,
  reviewOpen: false,
  historyOpen: false,
  permissionsOpen: false,
  accountPicker: null,
  useWorktree: false,
  reviewWhenDone: false,
  claudeAsChat: true,
  toast: null,
  suggestPaneId: null,
  composerPaneId: null,
  composerDraft: null,
  promptFill: null,
  checkpointsPaneId: null,
  fontDelta: 0,
  greetingPlayAt: 0,
  windowFocused: document.hasFocus(),
  set: (patch) => set(patch),
}));

interface SavedUi {
  mode?: Mode;
  agentPanelOpen?: boolean;
  railTab?: RailTab;
  railWidths?: Partial<Record<RailTab, number>>;
  nav?: NavView;
  single?: boolean;
  /** Pre-redesign flags, read once so an existing ui.json keeps its sidebar state. */
  filesOpen?: boolean;
  sidebarOpen?: boolean;
  useWorktree?: boolean;
  reviewWhenDone?: boolean;
  claudeAsChat?: boolean;
  fontDelta?: number;
  prefs?: unknown;
  stash?: unknown;
}

export async function loadUiState() {
  const r = await readSaved(() => ipc.loadState<SavedUi>("ui"));
  // notifications.ts imports this file, so the warning is a toast here.
  if (!r.ok) toast(`Couldn't read ui.json: ${r.error}. Settings changed now won't be saved this session.`, true);
  const saved = r.ok ? r.value : null;
  if (saved) {
    useUi.setState({
      mode: saved.mode === "agents" || saved.mode === "work" ? saved.mode : "terminals",
      agentPanelOpen: saved.agentPanelOpen ?? false,
      railTab: saved.railTab === "changes" || saved.railTab === "details" || saved.railTab === "notes" ? saved.railTab : "queue",
      railWidths: saved.railWidths ?? {},
      nav:
        saved.nav !== undefined
          ? saved.nav
          : saved.filesOpen
            ? "files"
            : saved.sidebarOpen === false
              ? null
              : "projects",
      single: saved.single ?? true,
      useWorktree: startWorktree(saved.useWorktree, useConfig.getState().config?.worktreeByDefault),
      reviewWhenDone: saved.reviewWhenDone ?? false,
      claudeAsChat: saved.claudeAsChat ?? true,
      fontDelta: saved.fontDelta ?? 0,
      prefs: normalizePrefs(saved.prefs),
      stash: Array.isArray(saved.stash) ? saved.stash.filter((x): x is string => typeof x === "string").slice(-10) : [],
    });
  }
  setTerminalsAllowed(useUi.getState().prefs.legacyTerminals);
  let last = "";
  useUi.subscribe((s) => {
    setTerminalsAllowed(s.prefs.legacyTerminals);
    const next = JSON.stringify({
      mode: s.mode,
      agentPanelOpen: s.agentPanelOpen,
      railTab: s.railTab,
      railWidths: s.railWidths,
      nav: s.nav,
      single: s.single,
      useWorktree: s.useWorktree,
      reviewWhenDone: s.reviewWhenDone,
      claudeAsChat: s.claudeAsChat,
      fontDelta: s.fontDelta,
      prefs: s.prefs,
      stash: s.stash,
    });
    if (r.ok && next !== last) {
      last = next;
      ipc.saveState("ui", JSON.parse(next)).catch(() => {});
    }
  });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, error = false) {
  useUi.getState().set({ toast: { text, error, at: Date.now() } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => useUi.getState().set({ toast: null }), error ? 6000 : 3000);
}
