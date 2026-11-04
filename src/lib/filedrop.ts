import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useLayout } from "../store/layout";
import { useUi } from "../store/ui";
import { attachToChat, focusChat, insertIntoChat } from "./chatComposer";
import { insertAtPrompt, showPane } from "./terminals";

/** Backslash-escapes a path for zsh, the way Terminal.app and iTerm do on drop. */
export function shellEscape(path: string) {
  return path.replace(/[^A-Za-z0-9_\-.,:/@+=%~]/g, "\\$&");
}

let hovered: HTMLElement | null = null;

function setHovered(el: HTMLElement | null) {
  if (el === hovered) return;
  hovered?.classList.remove("drop-target");
  el?.classList.add("drop-target");
  hovered = el;
}

/** Tauri reports physical pixels; the DOM works in CSS pixels. */
function paneAt(position: { x: number; y: number }): HTMLElement | null {
  const ratio = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(position.x / ratio, position.y / ratio);
  // A pane, or a thread row in the sidebar (when Settings → Threads & keys allows it).
  return el?.closest<HTMLElement>(useUi.getState().prefs.dropFiles ? "[data-pane-id], [data-thread]" : "[data-pane-id]") ?? null;
}

/**
 * Tauri's native drag-drop handler swallows file drops before the webview sees them,
 * so files dropped on a pane are turned into escaped paths typed at its prompt, or put
 * in a chat's message.
 */
export async function installFileDrop() {
  await getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === "enter" || p.type === "over") {
      setHovered(paneAt(p.position));
    } else if (p.type === "leave") {
      setHovered(null);
    } else if (p.type === "drop") {
      setHovered(null);
      const target = paneAt(p.position);
      const paneId = target?.dataset.paneId ?? target?.dataset.thread;
      if (!paneId || p.paths.length === 0) return;
      // A thread row opens its thread first, so the files land in the composer you can see.
      if (target?.dataset.thread) showPane(paneId);
      else useLayout.getState().focusPane(paneId);
      // A chat takes them as attachments; one not on screen yet gets the quoted paths in its draft.
      if (useLayout.getState().panes[paneId]?.mode === "chat") {
        if (!attachToChat(paneId, p.paths)) insertIntoChat(paneId, p.paths.map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(" ") + " ");
        focusChat(paneId);
      } else insertAtPrompt(paneId, p.paths.map(shellEscape).join(" ") + " ");
    }
  });
}
