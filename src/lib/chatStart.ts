// New tabs open straight into a chat (the Start screen is a Diagnostics toggle). Pure, for `node --test`.

import type { PaneMeta } from "../store/layout";

/** The patch that turns an empty "start" pane into a chat in its folder, on the folder's usual account. */
export function launcherToChat(
  pane: Pick<PaneMeta, "cwd" | "account">,
  o: { workspace?: string; preferred?: string; firstAccount?: string },
): Pick<PaneMeta, "launcher" | "mode" | "cwd" | "account"> {
  return { launcher: undefined, mode: "chat", cwd: pane.cwd || o.workspace || undefined, account: pane.account ?? o.preferred ?? o.firstAccount };
}

/** A chat nobody has written in yet: its folder can still change, and its first message can make a worktree. */
export function freshChat(pane: Pick<PaneMeta, "chatUsed" | "claudeSession"> | undefined, items: number): boolean {
  return !!pane && !pane.chatUsed && !pane.claudeSession && items === 0;
}

/**
 * Claude Code's extras a chat offers: editing a message (a copy of the conversation cut before
 * it), forking, permission modes. OpenCode's `run` has none of them (src-tauri/src/opencode_chat.rs).
 */
export function chatCan(pane: Pick<PaneMeta, "provider"> | undefined): { branch: boolean; fork: boolean; mode: boolean } {
  const claude = pane?.provider !== "opencode";
  return { branch: claude, fork: claude, mode: claude };
}
