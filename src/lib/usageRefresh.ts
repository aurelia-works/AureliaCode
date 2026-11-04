/**
 * When to re-read 5h/7d usage. The timer (store/usage.ts) reads each account on its interval;
 * a finished turn reads it once more so the meter moves when the work did, unless a read
 * happened moments ago or one is still running. Pure, for `node --test`.
 */

/** A turn end within this long of the last read reuses it. */
export const TURN_END_GAP_MS = 30_000;

export function timerDue(fetchedAt: number | undefined, now: number, everyMs: number): boolean {
  return now - (fetchedAt ?? 0) >= everyMs;
}

export function turnEndDue(fetchedAt: number | undefined, now: number, inflight: boolean): boolean {
  return !inflight && now - (fetchedAt ?? 0) >= TURN_END_GAP_MS;
}
