/**
 * Nightly review of old code (Theo, 2026-11-04 02:24: "Review agents also are running nightly over existing code
 * helping catch old bugs before they show up somewhere else"). Once a night, while the app is open, the council
 * (OpenCode models, no Claude limits) reads one folder of a repo; folders take turns. Only `important` findings two
 * reviewers agree on are kept, so the morning card is short.
 */
import { mergeCouncil, parseReport, type Finding } from "./council.ts";
import type { CouncilSeat } from "./ipc.ts";

/** The latest `hour`:00 at or before `now` (local time). */
function lastMark(now: number, hour: number): number {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

/** Due when tonight's hour has passed and there's been no run since it; a missed night runs when the app next opens. */
export function isDue(now: number, lastRun: number | undefined, hour: number): boolean {
  const mark = lastMark(now, hour);
  if (lastRun === undefined) return now >= mark && new Date(now).getHours() >= hour;
  return lastRun < mark;
}

export function nextFolder(folders: string[], last: string | undefined): string | undefined {
  if (!folders.length) return undefined;
  const i = last === undefined ? -1 : folders.indexOf(last);
  return i < 0 ? folders[0] : folders[(i + 1) % folders.length];
}

export interface Overnight {
  reviewers: number;
  score?: number;
  findings: Finding[];
}

export function overnight(seats: CouncilSeat[]): Overnight {
  const ok = seats.filter((s) => !s.failed);
  const c = mergeCouncil(ok.map((s) => parseReport(s.text, s.model)));
  return { reviewers: c.reviewers, score: c.score, findings: c.findings.filter((f) => f.verified && (f.tag === "important" || f.tag === "delete")) };
}
