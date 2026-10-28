import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyPlanner } from "./planner.ts";
import { addActivity, addJournal, journalFor, reviewFor, saveReview, scratchFor, setScratch, weekEnd, weekMarkdown, weekStart, weekStats, removeJournal } from "./plannerWeekly.ts";
import { toggleHabit, addHabit, logFocus } from "./plannerHabits.ts";
import { addGoal, ensureDay, toggleGoal } from "./plannerToday.ts";
import { addCard, moveCard } from "./plannerRoadmap.ts";

// Week of Mon 2026-10-26 .. Sun 2026-11-01.
const W = "2026-10-26";
const at = (d: number, h = 12) => new Date(2026, 9, d, h).toISOString();

test("weekStart is the local Monday, including on a Sunday and across a month", () => {
  assert.equal(weekStart("2026-10-28"), W);
  assert.equal(weekStart("2026-11-01"), W);
  assert.equal(weekStart("2026-10-26"), W);
  assert.equal(weekStart("2026-11-02"), "2026-11-02");
  assert.equal(weekEnd(W), "2026-11-01");
  assert.equal(weekStart("2026-03-01"), "2026-02-23");
});

const busy = () => {
  let s = ensureDay(emptyPlanner(), "2026-10-27");
  s = addGoal(s, "2026-10-27", "a", { points: 4 });
  s = addGoal(s, "2026-10-27", "b", { points: 4 });
  s = toggleGoal(s, "2026-10-27", s.dailyGoalsByDate["2026-10-27"].goals[0].id);
  s = addGoal(ensureDay(s, "2026-10-20"), "2026-10-20", "old goal"); // last week
  s = toggleGoal(s, "2026-10-20", s.dailyGoalsByDate["2026-10-20"].goals[0].id);
  s = addHabit(s, "Read");
  s = toggleHabit(toggleHabit(s, s.habits[0].id, "2026-10-27"), s.habits[0].id, "2026-10-19");
  s = logFocus(s, { startedAt: new Date(2026, 9, 28, 10).getTime(), minutes: 25, projectId: null }, new Date(2026, 9, 28, 10, 25).getTime());
  s = addActivity(addActivity(addActivity(s, "thread-settled", "t", at(27)), "pr-merged", "#9", at(27)), "thread-settled", "old", at(19));
  s = addCard(s, "p", "Ship", "next", at(20));
  s = moveCard(s, s.roadmapCards[0].id, "shipped", at(29));
  s = addJournal(s, "p", "note", "learned a thing");
  s.journalEntries[0].ts = at(28);
  return s;
};

test("weekStats counts only the week's goals, habits, focus, activity, cards and journal", () => {
  const st = weekStats(busy(), W);
  assert.equal(st.goalsCompleted, 1);
  assert.equal(st.goalPoints, 4);
  assert.equal(st.avgScore, 50);
  assert.equal(st.habitCheckins, 1);
  assert.equal(st.focusMinutes, 25);
  assert.equal(st.focusSessions, 1);
  assert.equal(st.threadsSettled, 1);
  assert.equal(st.prsMerged, 1);
  assert.equal(st.cardsShipped, 1);
  assert.equal(st.journalCount, 1);
});

test("editing an old shipped card does not make it ship again this week", () => {
  let s = addCard(emptyPlanner(), "p", "Old", "next", at(1));
  s = moveCard(s, s.roadmapCards[0].id, "shipped", at(2)); // an earlier week
  s = { ...s, roadmapCards: s.roadmapCards.map((c) => ({ ...c, title: "Renamed", updatedAt: at(28) })) };
  assert.equal(weekStats(s, W).cardsShipped, 0);
});

test("an empty week is all zeros", () => {
  const st = weekStats(emptyPlanner(), W);
  assert.ok(Object.values(st).every((v) => v === 0));
  assert.ok(weekMarkdown(W, st).startsWith("# Week of 2026-10-26"));
});

test("close week saves a review once per week and keeps the first createdAt", () => {
  let s = saveReview(busy(), W, "good week", false, "T1");
  assert.equal(reviewFor(s, W)!.closedAt, null);
  s = saveReview(s, W, "good week, closed", true, "T2");
  const r = reviewFor(s, W)!;
  assert.equal(s.weeklyReviews.length, 1);
  assert.equal(r.createdAt, "T1");
  assert.equal(r.closedAt, "T2");
  assert.ok((r.markdown as string).includes("good week, closed"));
});

test("journal entries are per project, newest first, and removable", () => {
  let s = addJournal(emptyPlanner(), "p", "decision", "first", null, "2026-10-27T10:00:00Z");
  s = addJournal(s, "p", "note", "second", null, "2026-10-28T10:00:00Z");
  s = addJournal(s, null, "idea", "general");
  assert.equal(addJournal(s, "p", "note", "  "), s);
  assert.deepEqual(journalFor(s, "p").map((j) => j.body), ["second", "first"]);
  assert.equal(journalFor(s, null).length, 1);
  assert.equal(removeJournal(s, journalFor(s, "p")[0].id).journalEntries.length, 2);
});

test("scratchpad is kept per project", () => {
  let s = setScratch(emptyPlanner(), "p", "todo: doors");
  s = setScratch(s, null, "general");
  assert.equal(scratchFor(s, "p"), "todo: doors");
  assert.equal(scratchFor(s, null), "general");
  assert.equal(scratchFor(s, "other"), "");
});
