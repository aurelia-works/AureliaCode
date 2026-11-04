/**
 * Permission modes AureliaCode offers: Manual (Claude's "default", asks before edits and
 * commands), Plan, Auto and Bypass. Auto-edit (`acceptEdits`) was dropped on 2026-11-04; a pane
 * Claude puts in it by itself still shows it, but nothing here picks it.
 */
export const PICKER_MODES = ["default", "plan", "auto", "bypassPermissions"] as const;

/** Shift+Tab's order in a chat. Bypass stays a deliberate pick in the mode menu. */
export const CHAT_CYCLE = ["default", "plan", "auto"];

/**
 * `--permission-mode` for a new Claude pane from the Settings value. Empty (never chosen) and
 * the old Auto-edit mean Auto; "default" (Manual) passes no flag.
 */
export function startPermissionMode(setting: string | undefined): string | undefined {
  const mode = !setting || setting === "acceptEdits" ? "auto" : setting;
  return mode === "default" ? undefined : mode;
}
