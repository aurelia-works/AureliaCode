/** Pure helpers for the thread list: pinning, keyboard stepping and renaming. */

/** Pin sets the order key to "now" (newest pin last); unpin clears it. */
export const pinPatch = (on: boolean, now: number): { pinned: number | undefined } => ({ pinned: on ? now : undefined });

/** Settling files a thread away and drops its pin, as T3 does. */
export const settlePatch = (): { settled: true; pinned: undefined } => ({ settled: true, pinned: undefined });

/** Pinned threads first (by pin order), everything else in its given order. */
export function splitPinned(ids: string[], panes: Record<string, { pinned?: number } | undefined>): { pinned: string[]; rest: string[] } {
  const pinned = ids.filter((id) => panes[id]?.pinned !== undefined).sort((a, b) => panes[a]!.pinned! - panes[b]!.pinned!);
  const set = new Set(pinned);
  return { pinned, rest: ids.filter((id) => !set.has(id)) };
}

/** Index to focus after ArrowUp/ArrowDown/Home/End in a list; -1 current means nothing focused yet. No wrap. */
export function stepFocus(count: number, current: number, key: string): number {
  if (count === 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return Math.min(count - 1, current + 1);
  if (key === "ArrowUp") return current <= 0 ? 0 : current - 1;
  return current;
}

/** A typed thread name: whitespace collapsed, at most 80 characters, empty means "use the automatic title". */
export function cleanTitle(input: string): string | undefined {
  const t = input.replace(/\s+/g, " ").trim().slice(0, 80);
  return t || undefined;
}

/** Agent sessions the Queue rail lists: a settled thread is filed away, so it leaves the queue. */
export function queueSessions<S extends { paneId: string }>(sessions: Record<string, S>, panes: Record<string, { settled?: boolean } | undefined>): S[] {
  return Object.values(sessions).filter((s) => !panes[s.paneId]?.settled);
}

/**
 * T3's recede rule: a thread that is busy on its own and isn't the one you're looking at
 * has nothing for you, so its row goes quiet and the ones that need you stand out.
 */
export function shouldRecede(t: { v: string | undefined; focused: boolean; selected: boolean }): boolean {
  return (t.v === "working" || t.v === "starting") && !t.focused && !t.selected;
}

/** A chat's state for its icon: a pending approval means it needs you, even mid-turn. */
export function chatIcon(status: string | undefined, approvals: number): "needs_input" | "working" | "starting" | "idle" {
  if (approvals > 0) return "needs_input";
  if (status === "working" || status === "waiting") return "working";
  if (status === "starting") return "starting";
  return "idle";
}

/** Panes whose chat is waiting on an approval, in order: the sidebar puts these under Needs you. */
export function approvalPanes(byPane: Record<string, { approvals: readonly unknown[] } | undefined>): string[] {
  return Object.keys(byPane).filter((id) => (byPane[id]?.approvals.length ?? 0) > 0);
}
