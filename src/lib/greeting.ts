// The title-bar wordmark's hourly greeting (TitleBar.tsx): on the hour "AureliaCode" morphs into
// "Morning, Jah", holds, then morphs back. One timer per hour, nothing per second.

export type PartOfDay = "Morning" | "Afternoon" | "Evening";

/** 5-11 morning, 12-17 afternoon, 18-4 evening (the small hours are still last night). */
export function partOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 18) return "Afternoon";
  return "Evening";
}

/** "Morning, Jah"; just "Morning" without a name. */
export function greetingFor(hour: number, name: string): string {
  const who = name.trim();
  return who ? `${partOfDay(hour)}, ${who}` : partOfDay(hour);
}

/** Milliseconds to the next top of the hour (a full hour when it's exactly on one). */
export function msUntilNextHour(now: Date): number {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next.getTime() - now.getTime();
}

export const HOLD_SECONDS = { min: 2, max: 20, fallback: 6 } as const;

/** The hold, in whole seconds within 2-20; 6 when it isn't a number. */
export function clampHoldSeconds(n: number): number {
  return Number.isFinite(n) ? Math.min(HOLD_SECONDS.max, Math.max(HOLD_SECONDS.min, Math.round(n))) : HOLD_SECONDS.fallback;
}
