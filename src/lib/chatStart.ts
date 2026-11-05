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
export function freshChat(pane: Pick<PaneMeta, "chatUsed"> | undefined, items: number): boolean {
  // Claude assigns a session id as soon as the process starts, before the first message.
  // That id is not usage: only a sent message (chatUsed) or a transcript item makes a chat old.
  return !!pane && !pane.chatUsed && items === 0;
}

/**
 * What to do when a chat's saved transcript can't be read on resume. Only a file that is really
 * gone (chat.rs `session_text`: "No such file or directory") drops the session; any other error
 * (a renamed account, a config that failed to load) keeps it so the conversation isn't lost.
 * A used chat stays used either way and says why in its transcript; an unused one says nothing.
 */
export function missingHistory(error: string, used: boolean): { clearSession: boolean; notice?: string } {
  // An unused chat has nothing to lose: always start it clean.
  if (!used) return { clearSession: true };
  const gone = /No such file or directory|os error 2\b/.test(error);
  return gone
    ? { clearSession: true, notice: "The earlier conversation couldn't be found, so this is a new chat" }
    : { clearSession: false, notice: `Couldn't load the earlier messages (${error}); new messages continue the conversation` };
}

/**
 * Claude Code's extras a chat offers: editing a message (a copy of the conversation cut before
 * it), forking, permission modes. OpenCode's `run` has none of them (src-tauri/src/opencode_chat.rs).
 */
export function chatCan(pane: Pick<PaneMeta, "provider"> | undefined): { branch: boolean; fork: boolean; mode: boolean } {
  const claude = pane?.provider !== "opencode";
  return { branch: claude, fork: claude, mode: claude };
}
