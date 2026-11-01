/** What dragging a thread from one section of the list to another does. Pure; the sidebar applies the result. */

export type Zone = "pinned" | "active" | "snoozed" | "settled";

export interface DropPlan {
  patch: { pinned?: number | undefined; settled?: boolean; snoozedUntil?: number | undefined };
  /** Undo toast verb: "Pinned 1 thread". */
  verb: string;
  /** Shown on the target section while dragging: what a drop would do. */
  label: string;
}

/** The section a thread sits in. A pinned thread is only pinned while it is also active. */
export function zoneOf(p: { pinned?: number; settled?: boolean } & { snoozed?: boolean }): Zone {
  if (p.settled) return "settled";
  if (p.snoozed) return "snoozed";
  return p.pinned !== undefined ? "pinned" : "active";
}

/** null = the drop does nothing (same section, or snoozing by drag, which needs a wake time). */
export function dropPlan(from: Zone, to: Zone, now: number): DropPlan | null {
  if (from === to || to === "snoozed") return null;
  if (to === "pinned") return { patch: { pinned: now, settled: false, snoozedUntil: undefined }, verb: "Pinned", label: from === "active" ? "Pin" : "Wake and pin" };
  if (to === "settled") return { patch: { settled: true, pinned: undefined }, verb: "Settled", label: "Settle" };
  // Into the active list.
  if (from === "pinned") return { patch: { pinned: undefined }, verb: "Unpinned", label: "Unpin" };
  return { patch: { settled: false, snoozedUntil: undefined }, verb: "Woke", label: from === "settled" ? "Un-settle" : "Wake" };
}

/**
 * Pin key that puts `dragId` just before `beforeId` among the pinned threads (or last when `beforeId` is null).
 * Keys are numbers; a key between two neighbours is their midpoint.
 */
export function pinKeyBefore(order: { id: string; pinned: number }[], dragId: string, beforeId: string | null, now: number): number {
  const rest = order.filter((o) => o.id !== dragId);
  if (beforeId === null) return Math.max(now, (rest.at(-1)?.pinned ?? 0) + 1);
  const i = rest.findIndex((o) => o.id === beforeId);
  if (i < 0) return Math.max(now, (rest.at(-1)?.pinned ?? 0) + 1);
  const next = rest[i].pinned;
  const prev = i > 0 ? rest[i - 1].pinned : next - 2;
  return (prev + next) / 2;
}
