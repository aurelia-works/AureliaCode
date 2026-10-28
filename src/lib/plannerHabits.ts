import type { FocusSession, Habit, HabitCompletion, PlannerState } from "./planner.ts";
import { localDate, newId } from "./plannerToday.ts";

/** "YYYY-MM-DD" parsed as a local date (not UTC), shifted by whole days. */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return localDate(new Date(y, m - 1, d + days));
}
const weekday = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};

/** Whether the habit is expected on that day (0 = Sunday for custom days). */
export function isDue(h: Habit, date: string): boolean {
  const w = weekday(date);
  return h.frequency === "daily" ? true : h.frequency === "weekdays" ? w >= 1 && w <= 5 : h.customDays.includes(w);
}

export const doneOn = (cs: HabitCompletion[], habitId: string, date: string) => cs.some((c) => c.habitId === habitId && c.date === date);

/**
 * Consecutive due days with a check-in, counted back from today. Today only counts once ticked, but an
 * unticked today doesn't break the streak yet. Days the habit isn't due are skipped.
 */
export function streak(h: Habit, cs: HabitCompletion[], today: string): number {
  const done = new Set(cs.filter((c) => c.habitId === h.id).map((c) => c.date));
  let n = 0;
  let d = today;
  for (let i = 0; i < 400; i++, d = shiftDate(d, -1)) {
    if (!isDue(h, d)) continue;
    if (done.has(d)) n++;
    else if (d !== today) break;
  }
  return n;
}

export function toggleHabit(s: PlannerState, habitId: string, date: string, now = new Date().toISOString()): PlannerState {
  if (doneOn(s.habitCompletions, habitId, date)) return { ...s, habitCompletions: s.habitCompletions.filter((c) => !(c.habitId === habitId && c.date === date)) };
  return { ...s, habitCompletions: [...s.habitCompletions, { id: newId("hc"), habitId, date, createdAt: now }] };
}

export function addHabit(s: PlannerState, title: string, frequency: Habit["frequency"] = "daily", now = new Date().toISOString()): PlannerState {
  const t = title.trim();
  if (!t) return s;
  const h: Habit = { id: newId("h"), title: t, frequency, customDays: [], color: "#7c5cfc", icon: "⚡", linkedProjectId: null, targetStreak: 30, createdAt: now, updatedAt: now, archivedAt: null };
  return { ...s, habits: [...s.habits, h] };
}
export const archiveHabit = (s: PlannerState, id: string, now = new Date().toISOString()): PlannerState => ({ ...s, habits: s.habits.map((h) => (h.id === id ? { ...h, archivedAt: now, updatedAt: now } : h)) });

/** Habits due today and not archived. */
export const dueToday = (s: PlannerState, date: string) => s.habits.filter((h) => !h.archivedAt && isDue(h, date));

// ---- Focus timer ----

export interface RunningFocus {
  startedAt: number;
  minutes: number;
  projectId: string | null;
}
export const remainingMs = (f: RunningFocus, now: number) => Math.max(0, f.startedAt + f.minutes * 60_000 - now);
export const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Logs a focus session. Ran to the end: the planned minutes, completed. Stopped early: the minutes actually
 * spent, not completed, and nothing at all under one minute.
 */
export function logFocus(s: PlannerState, f: RunningFocus, now: number): PlannerState {
  const finished = remainingMs(f, now) === 0;
  const minutes = finished ? f.minutes : Math.floor((now - f.startedAt) / 60_000);
  if (minutes < 1) return s;
  const rec: FocusSession = {
    id: newId("f"),
    startedAt: new Date(f.startedAt).toISOString(),
    durationMinutes: minutes,
    completedAt: finished ? new Date(now).toISOString() : null,
    planned: false,
    projectId: f.projectId,
    reason: null,
  };
  return { ...s, focusSessions: [...s.focusSessions, rec] };
}

/** Minutes of completed-or-partial focus on a local date. */
export function focusMinutesOn(s: PlannerState, date: string): number {
  return s.focusSessions.filter((f) => localDate(new Date(f.startedAt)) === date).reduce((n, f) => n + f.durationMinutes, 0);
}
