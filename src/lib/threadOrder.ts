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
