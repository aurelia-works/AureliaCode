import type { PaneMeta } from "../store/layout";

/**
 * What ⌘A does in the focused pane. "native" leaves the key to the WebView.
 * A chat keeps its empty box focused, so an empty box means the conversation.
 */
export function selectAllAction(pane: Partial<PaneMeta> | undefined, inTextField: boolean, fieldEmpty = false): "native" | "terminal" | "chat" {
  if (!pane || pane.launcher || pane.browser || pane.editor) return "native";
  if (inTextField && !(fieldEmpty && pane.mode === "chat")) return "native";
  return pane.mode === "chat" ? "chat" : "terminal";
}

/** Selects the whole message list of a chat pane, so ⌘C copies the conversation and nothing else. */
export function selectChatLog(paneId: string): void {
  const log = document.querySelector(`[data-pane-id="${CSS.escape(paneId)}"] .chat-log`);
  const sel = window.getSelection();
  if (!log || !sel) return;
  // WebKit keeps a focused text box's own selection, and ⌘C would copy that instead.
  log.closest<HTMLElement>(".chat")?.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(log);
  sel.removeAllRanges();
  sel.addRange(range);
}
