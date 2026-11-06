/**
 * Bundled `/untangle-codebase` skill. Rust copies the packaged files into an isolated
 * account's Claude skills folder. This module decides when that install is allowed, how a
 * live session's command list changes the status, and the one message a confirmed invocation
 * sends. It does not start a refactor.
 */

export const UNTANGLE_NAME = "untangle-codebase";

/** Preview harness opens the invocation dialog for a pane id. */
export const UNTANGLE_OPEN = "aurelia-untangle-open";

export const COMMENTS_DESC = "Remove comments that only restate the code.";
export const TESTS_DESC = "Remove tests that wouldn't catch a real bug, and fix the ones that fail without one.";

/** Exact additions phrases the skill looks for. Default is refactor only, which does not delete tests. */
export const ADDITION_CLAUSE = {
  refactor: "additions: refactor only",
  comments: "additions: refactor plus comments",
  tests: "additions: refactor plus tests",
  both: "additions: refactor plus comments and tests",
} as const;

export type UntangleAdditions = keyof typeof ADDITION_CLAUSE;

export type UntangleDiskState = "unavailable" | "notInstalled" | "conflict" | "outdated" | "installed";

/** What the account folder holds. Session discovery is applied separately. */
export interface UntangleDisk {
  state: UntangleDiskState;
  reason: string;
  configDir: string | null;
  skillDir: string | null;
}

export type UntangleAvailKind = Exclude<UntangleDiskState, "installed"> | "needsRestart" | "ready";

export interface UntangleAvail {
  kind: UntangleAvailKind;
  reason: string;
}

/** A Claude chat that is open in this app. `commands` is null until the session reports them. */
export interface UntangleSession {
  commands: { name: string }[] | null;
}

export interface UntangleApi {
  untangleStatus(account: string): Promise<UntangleDisk>;
  untangleInstall(account: string): Promise<UntangleDisk>;
}

const ADDITION_SUFFIX = /\s+--\s+additions:\s+refactor(?:\s+only|\s+plus\s+comments(?:\s+and\s+tests)?|\s+plus\s+tests)\s*$/i;

/** The optional area, without a previous additions clause and without a line break. */
export function focusArea(area: string): string {
  const line = area.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().replace(ADDITION_SUFFIX, "").trim();
  return line.slice(0, 400);
}

/** The whole composer text when it is this command, or null when it is anything else. */
export function parseUntangleCommand(text: string): { area: string } | null {
  const match = /^\/untangle-codebase(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  return { area: focusArea(match[1] ?? "") };
}

/** The one slash message sent into the session. The skill body is not copied into it. */
export function invocationMessage(area: string, additions: UntangleAdditions): string {
  const focus = focusArea(area);
  const clause = ADDITION_CLAUSE[additions];
  return focus ? `/${UNTANGLE_NAME} ${focus} -- ${clause}` : `/${UNTANGLE_NAME} ${clause}`;
}

export interface UntanglePreview {
  /** Sent once. */
  message: string;
  /** Packaged skill text, shown so the user can read it. Not sent again. */
  skill: string;
}

export function untanglePreview(skill: string, area: string, additions: UntangleAdditions): UntanglePreview {
  return { message: invocationMessage(area, additions), skill };
}

export function installAllowed(state: UntangleDiskState): boolean {
  return state === "notInstalled" || state === "outdated";
}

/**
 * Install only when the last status says the copy is missing or outdated.
 * Unavailable, conflict, and an up-to-date install do not call the writer.
 */
export async function routeUntangleInstall(api: UntangleApi, account: string): Promise<UntangleDisk> {
  const status = await api.untangleStatus(account);
  if (!installAllowed(status.state)) return status;
  return api.untangleInstall(account);
}

export function diskOrUnavailable(disk: UntangleDisk | null, error: string | null): UntangleDisk {
  if (disk) return disk;
  return {
    state: "unavailable",
    reason: error ?? "Install isn't available in this app state, so nothing is written to ~/.claude.",
    configDir: null,
    skillDir: null,
  };
}

export function statusLabel(kind: UntangleAvailKind): string {
  switch (kind) {
    case "unavailable":
      return "Unavailable";
    case "notInstalled":
      return "Not installed";
    case "conflict":
      return "Not installed, conflict";
    case "outdated":
      return "Installed, update available";
    case "needsRestart":
      return "Installed, open sessions need a new launch";
    case "ready":
      return "Ready for new sessions";
  }
}

function listsSkill(session: UntangleSession): boolean {
  return !!session.commands?.some((c) => c.name === UNTANGLE_NAME);
}

/** Disk state, then whether open Claude chats already list the skill. */
export function untangleAvail(disk: UntangleDisk, sessions: UntangleSession[]): UntangleAvail {
  if (disk.state !== "installed") return { kind: disk.state, reason: disk.reason };
  const unseen = sessions.filter((s) => !listsSkill(s));
  if (unseen.length) {
    const noun = unseen.length === 1 ? "1 open chat" : `${unseen.length} open chats`;
    return {
      kind: "needsRestart",
      reason: `Installed, but ${noun} on this account do not list /${UNTANGLE_NAME}. Claude Code reads skills when a session starts, so start a new Claude session. Nothing runs until you invoke it there.`,
    };
  }
  return {
    kind: "ready",
    reason: sessions.length
      ? `Ready. Open Claude chats on this account list /${UNTANGLE_NAME}.`
      : `Ready for new sessions. The next Claude session on this account loads /${UNTANGLE_NAME}. Nothing runs until you invoke it. Open chats are checked; a Claude terminal keeps the skills it had at launch.`,
  };
}

export interface HostPane {
  account?: string;
  provider?: string;
  mode?: string;
  launcher?: boolean;
  browser?: unknown;
  editor?: unknown;
  agent?: string;
  customAgent?: string;
}

export interface HostChat {
  status?: string;
  commands?: { name: string }[];
}

/** Open Claude chats for this account. A terminal Claude is not in this list; the ready text says so. */
export function accountSessions(account: string, panes: Record<string, HostPane>, chats: Record<string, HostChat | undefined>): UntangleSession[] {
  const out: UntangleSession[] = [];
  for (const [id, pane] of Object.entries(panes)) {
    if (pane.account !== account || pane.provider === "opencode") continue;
    if (pane.launcher || pane.browser || pane.editor || pane.agent || pane.customAgent) continue;
    if (pane.mode !== "chat") continue;
    const chat = chats[id];
    if (!chat || chat.status === "exited") continue;
    out.push({ commands: chat.commands ?? null });
  }
  return out;
}

export function untangleSendGate(input: { provider?: string; commands: { name: string }[] | null | undefined }): { ok: true } | { ok: false; reason: string } {
  if (input.provider === "opencode") {
    return { ok: false, reason: "OpenCode does not load this account's Claude skills. /untangle-codebase is not available in this session. Nothing was sent." };
  }
  if (!input.commands) {
    return {
      ok: false,
      reason: "This session has not reported its commands, so /untangle-codebase is not confirmed here. Start a new Claude session after the skill is installed. Nothing was sent.",
    };
  }
  if (!input.commands.some((c) => c.name === UNTANGLE_NAME)) {
    return {
      ok: false,
      reason: "This session does not list /untangle-codebase. Claude Code reads skills when a session starts. Install it for an isolated account, then start a new Claude session. Nothing was sent.",
    };
  }
  return { ok: true };
}
