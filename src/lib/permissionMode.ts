import { chatCan } from "./chatStart";
import { useAgents } from "../store/agents";
import { useLayout } from "../store/layout";
import { toast } from "../store/ui";
import { setChatMode, useChat } from "./chat";
import { CHAT_CYCLE } from "./startMode";
import { screenText, writeToPane } from "./terminals";

export { CHAT_CYCLE, PICKER_MODES } from "./startMode";

export interface ModeInfo {
  label: string;
  short: string;
  /** What the mode lets Claude do, for the picker. */
  what: string;
  tone?: "warn" | "danger";
}

/**
 * Claude Code's permission modes. Hooks report "default" for the one `--permission-mode`
 * calls "manual". Auto and bypass only appear in Claude's Shift+Tab cycle when the session
 * allows them; don't-ask only when started in it.
 */
export const MODES: Record<string, ModeInfo> = {
  default: { label: "Manual", short: "manual", what: "Asks before edits and commands" },
  // Not offered any more; shown only when Claude reports it (e.g. a terminal pane's own Shift+Tab).
  acceptEdits: { label: "Accept edits", short: "accept edits", what: "Accepts file edits, asks for commands", tone: "warn" },
  plan: { label: "Plan", short: "plan", what: "Reads and plans, changes nothing" },
  auto: { label: "Auto", short: "auto", what: "Claude decides what's safe to run", tone: "warn" },
  bypassPermissions: { label: "Bypass", short: "bypass", what: "Never asks", tone: "danger" },
  dontAsk: { label: "Don't ask", short: "don't ask", what: "Denies anything not already allowed", tone: "danger" },
};

export const modeKey = (mode: string | undefined) => (!mode || mode === "manual" ? "default" : mode);

/** Reads the mode from the indicator Claude Code prints under its input ("⏵⏵ accept edits on"). */
export function modeFromScreen(paneId: string): string {
  const text = screenText(paneId).toLowerCase();
  if (/bypass permissions on/.test(text)) return "bypassPermissions";
  if (/accept edits on/.test(text)) return "acceptEdits";
  if (/plan mode on/.test(text)) return "plan";
  if (/auto mode on/.test(text)) return "auto";
  if (/don.t ask on/.test(text)) return "dontAsk";
  return "default";
}

function record(paneId: string, mode: string) {
  useAgents.setState((s) => {
    const cur = s.sessions[paneId];
    return cur ? { sessions: { ...s.sessions, [paneId]: { ...cur, permissionMode: mode } } } : s;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Presses Shift+Tab in the pane (Claude Code's own mode switch) and records where it landed. */
export async function cyclePermissionMode(paneId: string): Promise<string> {
  const pane = useLayout.getState().panes[paneId];
  // OpenCode runs on its own permission rules: nothing to cycle.
  if (pane?.mode === "chat" && !chatCan(pane).mode) return modeKey(useChat.getState().byPane[paneId]?.mode);
  if (pane?.mode === "chat") {
    const mode = CHAT_CYCLE[(CHAT_CYCLE.indexOf(modeKey(useChat.getState().byPane[paneId]?.mode)) + 1) % CHAT_CYCLE.length];
    await setChatMode(paneId, mode);
    record(paneId, mode);
    return mode;
  }
  writeToPane(paneId, "\x1b[Z");
  await sleep(250);
  const mode = modeFromScreen(paneId);
  record(paneId, mode);
  return mode;
}

/** Shift+Tabs until the pane is in `target`; gives up after a full cycle (the mode isn't offered). */
export async function setPermissionMode(paneId: string, target: string): Promise<boolean> {
  // A chat pane switches through Claude Code's control channel: every mode, no key presses.
  const pane = useLayout.getState().panes[paneId];
  if (pane?.mode === "chat") {
    // OpenCode has no modes to switch to.
    if (!chatCan(pane).mode) return false;
    await setChatMode(paneId, target);
    return true;
  }
  const start = modeFromScreen(paneId);
  if (start === target) return record(paneId, start), true;
  for (let i = 0; i < 6; i++) {
    const now = await cyclePermissionMode(paneId);
    if (now === target) return true;
    if (now === start) break;
  }
  toast(`${MODES[target]?.label ?? target} isn't offered in this session. Settings → Claude panes can start new panes in it.`, true);
  return false;
}
