import type { PaneMeta } from "../store/layout";

/**
 * AureliaCode is chat-first: terminal panes only exist when Settings → Diagnostics →
 * "Legacy terminal panes" is on. The layout store runs every new, updated and restored
 * pane through `paneForLayout`, so no call site can open a terminal by accident.
 */
let terminalsAllowed = false;

export function setTerminalsAllowed(on: boolean) {
  terminalsAllowed = on;
}

export function paneForLayout(pane: PaneMeta): PaneMeta {
  return terminalsAllowed ? pane : withoutTerminal(pane);
}

/** A pane that would be a terminal becomes a chat (plain Claude) or the start screen (anything else). */
export function withoutTerminal(pane: PaneMeta): PaneMeta {
  if (pane.launcher || pane.browser || pane.editor || pane.mode === "chat") return pane;
  if (pane.account && !pane.agent && !pane.customAgent) return { ...pane, mode: "chat" };
  return { ...pane, launcher: true, mode: undefined };
}
