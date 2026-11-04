import type { Attachment } from "./attachments";

/**
 * The chat composers' text, reachable from outside React: dictation, the files panel, file
 * drops and the review panel type into a chat here, as they type at a terminal's prompt.
 * A chat that isn't on screen gets the text in its draft, shown when it mounts.
 */

/** Unsent text and attachments per chat, so switching tabs or panes keeps them. */
export const drafts = new Map<string, { text: string; atts: Attachment[] }>();

interface Handle {
  insert(text: string): void;
  focus(): void;
  /** Files dropped from Finder become chips. */
  attach(paths: string[]): void;
}

const mounted = new Map<string, Handle>();

export function registerComposer(paneId: string, h: Handle) {
  mounted.set(paneId, h);
  return () => {
    if (mounted.get(paneId) === h) mounted.delete(paneId);
  };
}

/** `add` after `cur`, with a space between unless `cur` already ends in one. */
export const appendText = (cur: string, add: string) => (cur && !/\s$/.test(cur) ? `${cur} ` : cur) + add;

export function insertIntoChat(paneId: string, text: string) {
  const h = mounted.get(paneId);
  if (h) return h.insert(text);
  const d = drafts.get(paneId) ?? { text: "", atts: [] };
  drafts.set(paneId, { ...d, text: appendText(d.text, text) });
}

/** Files dropped on a chat: chips in its composer. False when the composer isn't on screen. */
export function attachToChat(paneId: string, paths: string[]): boolean {
  const h = mounted.get(paneId);
  if (!h) return false;
  h.attach(paths);
  return true;
}

export function focusChat(paneId: string) {
  mounted.get(paneId)?.focus();
}
