import { localDate } from "./plannerToday.ts";

/** "2026-10-28-scratch-a1b2": the folder name for a thread that has no project. */
export function scratchName(now: Date, id: string): string {
  const tag = id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "x";
  return `${localDate(now)}-scratch-${tag}`;
}
