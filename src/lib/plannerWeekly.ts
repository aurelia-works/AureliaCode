import type { ActivityEvent, JournalEntry, Loose, PlannerState } from "./planner.ts";
import { shiftDate } from "./plannerHabits.ts";
import { localDate, newId } from "./plannerToday.ts";

/** Monday of the local week that contains `date`. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return shiftDate(date, -((dow + 6) % 7));
}
export const weekEnd = (start: string) => shiftDate(start, 6);

export interface WeekStats {
  goalsCompleted: number;
  goalPoints: number;
  avgScore: number;
  habitCheckins: number;
  focusMinutes: number;
  focusSessions: number;
  threadsSettled: number;
  prsMerged: number;
  cardsShipped: number;
  tasksDone: number;
  journalCount: number;
}

const inWeek = (date: string, start: string) => date >= start && date <= weekEnd(start);
const dayOf = (iso: string) => localDate(new Date(iso));

/** Everything that happened in the week starting `start`, counted from planner data and the activity log. */
export function weekStats(s: PlannerState, start: string): WeekStats {
  const days = Object.values(s.dailyGoalsByDate).filter((d) => inWeek(d.date, start));
  const goals = days.flatMap((d) => d.goals.filter((g) => g.done));
  const scored = days.filter((d) => d.goals.length);
  const act = s.activity.filter((a) => inWeek(dayOf(a.ts), start));
  const focus = s.focusSessions.filter((f) => inWeek(dayOf(f.startedAt), start));
  return {
    goalsCompleted: goals.length,
    goalPoints: goals.reduce((n, g) => n + g.points, 0),
    avgScore: scored.length ? Math.round(scored.reduce((n, d) => n + d.score, 0) / scored.length) : 0,
    habitCheckins: s.habitCompletions.filter((c) => inWeek(c.date, start)).length,
    focusMinutes: focus.reduce((n, f) => n + f.durationMinutes, 0),
    focusSessions: focus.length,
    threadsSettled: act.filter((a) => a.kind === "thread-settled").length,
    prsMerged: act.filter((a) => a.kind === "pr-merged").length,
    cardsShipped: act.filter((a) => a.kind === "card-shipped").length,
    tasksDone: s.projects.flatMap((p) => p.tasks).filter((t) => t.completedAt && inWeek(dayOf(t.completedAt), start)).length,
    journalCount: s.journalEntries.filter((j) => inWeek(dayOf(j.ts), start)).length,
  };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function weekMarkdown(start: string, st: WeekStats, notes = ""): string {
  const rows = [
    `- Goals: ${st.goalsCompleted} done, ${st.goalPoints} points, average score ${st.avgScore}%`,
    `- Threads settled: ${st.threadsSettled}; PRs merged: ${st.prsMerged}; roadmap cards shipped: ${st.cardsShipped}`,
    `- Project tasks done: ${st.tasksDone}`,
    `- Habit check-ins: ${st.habitCheckins}`,
    `- Focus: ${st.focusMinutes} min over ${plural(st.focusSessions, "session")}`,
    `- Journal entries: ${st.journalCount}`,
  ];
  return [`# Week of ${start}`, "", ...rows, ...(notes.trim() ? ["", "## Notes", notes.trim()] : [])].join("\n");
}

export function highlights(st: WeekStats): string[] {
  const h: string[] = [];
  if (st.prsMerged) h.push(`${plural(st.prsMerged, "PR")} merged`);
  if (st.cardsShipped) h.push(`${plural(st.cardsShipped, "card")} shipped`);
  if (st.focusMinutes >= 120) h.push(`${Math.round(st.focusMinutes / 60)} h of focus`);
  if (st.avgScore >= 80) h.push(`goal score averaged ${st.avgScore}%`);
  return h;
}

export const reviewId = (start: string) => `week-${start}`;
export const reviewFor = (s: PlannerState, start: string): Loose | undefined => s.weeklyReviews.find((r) => r.id === reviewId(start));

/** Saves (or re-saves) the week's review with fresh stats; `close` also stamps closedAt. */
export function saveReview(s: PlannerState, start: string, notes: string, close: boolean, now = new Date().toISOString()): PlannerState {
  const st = weekStats(s, start);
  const prev = reviewFor(s, start);
  const review: Loose = {
    id: reviewId(start),
    weekStart: start,
    weekEnd: weekEnd(start),
    stats: st,
    highlights: highlights(st),
    notes,
    markdown: weekMarkdown(start, st, notes),
    createdAt: (prev?.createdAt as string) ?? now,
    closedAt: close ? now : ((prev?.closedAt as string | null) ?? null),
  };
  return { ...s, weeklyReviews: [...s.weeklyReviews.filter((r) => r.id !== review.id), review] };
}

export const addActivity = (s: PlannerState, kind: ActivityEvent["kind"], label: string, now = new Date().toISOString()): PlannerState => ({
  ...s,
  activity: [...s.activity, { id: newId("a"), ts: now, kind, label }].slice(-2000),
});

// ---- Journal and scratchpad ----

export function addJournal(s: PlannerState, projectId: string | null, type: JournalEntry["type"], body: string, title: string | null = null, now = new Date().toISOString()): PlannerState {
  const b = body.trim();
  if (!b) return s;
  const e: JournalEntry = { id: newId("j"), projectId, ts: now, type, title, body: b, tags: [], createdAt: now, updatedAt: now };
  return { ...s, journalEntries: [e, ...s.journalEntries] };
}
export const removeJournal = (s: PlannerState, id: string): PlannerState => ({ ...s, journalEntries: s.journalEntries.filter((j) => j.id !== id) });
export const journalFor = (s: PlannerState, projectId: string | null) => s.journalEntries.filter((j) => j.projectId === projectId).sort((a, b) => b.ts.localeCompare(a.ts));
export const setScratch = (s: PlannerState, projectId: string | null, text: string): PlannerState => ({ ...s, scratchpads: { ...s.scratchpads, [projectId ?? ""]: text } });
export const scratchFor = (s: PlannerState, projectId: string | null) => s.scratchpads[projectId ?? ""] ?? "";
