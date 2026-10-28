import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyPlanner, normalizePlanner } from "./planner.ts";
import { addHabit, archiveHabit, clock, doneOn, dueToday, focusMinutesOn, isDue, logFocus, remainingMs, shiftDate, streak, toggleHabit } from "./plannerHabits.ts";

// 2026-10-28 is a Wednesday.
const mk = (frequency: "daily" | "weekdays" | "custom" = "daily", customDays: number[] = []) => {
  const s = addHabit(emptyPlanner(), "Read", frequency);
  s.habits[0].customDays = customDays;
  return s;
};
const tick = (s: ReturnType<typeof mk>, ...dates: string[]) => dates.reduce((acc, d) => toggleHabit(acc, acc.habits[0].id, d), s);

test("shiftDate crosses months and years on the local calendar", () => {
  assert.equal(shiftDate("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDate("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftDate("2026-10-28", 5), "2026-11-02");
});

test("due days by frequency", () => {
  const [w] = mk("weekdays").habits;
  assert.equal(isDue(w, "2026-10-28"), true);
  assert.equal(isDue(w, "2026-10-31"), false);
  const [c] = mk("custom", [0, 6]).habits;
  assert.equal(isDue(c, "2026-10-31"), true);
  assert.equal(isDue(c, "2026-10-28"), false);
});

test("daily streak counts back from today; an unticked today doesn't break it", () => {
  const s = tick(mk(), "2026-10-26", "2026-10-27");
  assert.equal(streak(s.habits[0], s.habitCompletions, "2026-10-28"), 2);
  const t = tick(s, "2026-10-28");
  assert.equal(streak(t.habits[0], t.habitCompletions, "2026-10-28"), 3);
});

test("a missed day resets the streak", () => {
  const s = tick(mk(), "2026-10-25", "2026-10-27", "2026-10-28");
  assert.equal(streak(s.habits[0], s.habitCompletions, "2026-10-28"), 2);
});

test("weekday habit skips the weekend", () => {
  const s = tick(mk("weekdays"), "2026-10-23", "2026-10-26", "2026-10-27");
  assert.equal(streak(s.habits[0], s.habitCompletions, "2026-10-27"), 3);
});

test("rollover at local midnight: the same completions read differently on the next date", () => {
  const s = tick(mk(), "2026-10-28");
  assert.equal(doneOn(s.habitCompletions, s.habits[0].id, "2026-10-28"), true);
  assert.equal(doneOn(s.habitCompletions, s.habits[0].id, "2026-10-29"), false);
  assert.equal(streak(s.habits[0], s.habitCompletions, "2026-10-29"), 1);
  assert.equal(streak(s.habits[0], s.habitCompletions, "2026-10-30"), 0);
});

test("toggle twice removes the check-in; archived habits aren't due", () => {
  let s = tick(mk(), "2026-10-28", "2026-10-28");
  assert.equal(s.habitCompletions.length, 0);
  assert.equal(dueToday(s, "2026-10-28").length, 1);
  s = archiveHabit(s, s.habits[0].id);
  assert.equal(dueToday(s, "2026-10-28").length, 0);
});

test("focus: a full session logs the planned minutes as completed", () => {
  const f = { startedAt: Date.UTC(2026, 9, 28, 12), minutes: 25, projectId: "p1" };
  assert.equal(remainingMs(f, f.startedAt + 60_000), 24 * 60_000);
  const s = logFocus(emptyPlanner(), f, f.startedAt + 25 * 60_000);
  assert.equal(s.focusSessions[0].durationMinutes, 25);
  assert.ok(s.focusSessions[0].completedAt);
  assert.equal(s.focusSessions[0].projectId, "p1");
});

test("focus: stopping early logs the minutes spent, not completed; under a minute logs nothing", () => {
  const f = { startedAt: 0, minutes: 25, projectId: null };
  const s = logFocus(emptyPlanner(), f, 7.9 * 60_000);
  assert.equal(s.focusSessions[0].durationMinutes, 7);
  assert.equal(s.focusSessions[0].completedAt, null);
  assert.equal(logFocus(emptyPlanner(), f, 30_000).focusSessions.length, 0);
  assert.equal(clock(65_000), "1:05");
});

test("focusMinutesOn sums one local day", () => {
  const f = { startedAt: new Date(2026, 9, 28, 10).getTime(), minutes: 25, projectId: null };
  const s = logFocus(emptyPlanner(), f, f.startedAt + 25 * 60_000);
  assert.equal(focusMinutesOn(s, "2026-10-28"), 25);
  assert.equal(focusMinutesOn(s, "2026-10-29"), 0);
});

test("a saved planner without settings gets the Pomodoro defaults", () => {
  assert.equal(normalizePlanner({ habits: [] }).settings.focusMinutes, 25);
});
