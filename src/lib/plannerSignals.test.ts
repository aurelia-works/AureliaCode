import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyPlanner, type PlannerState } from "./planner.ts";
import { briefing, dismissBriefing, evaluate, FOREVER, snooze, visible } from "./plannerSignals.ts";
import { addGoal, ensureDay } from "./plannerToday.ts";
import { addCard, moveCard } from "./plannerRoadmap.ts";

const NOW = new Date(2026, 9, 28, 12, 0); // Wed 28 Oct 2026, noon
const sec = (daysAgo: number) => NOW.getTime() / 1000 - daysAgo * 86_400;
const proj = (s: PlannerState): PlannerState => ({ ...s, projects: [{ id: "p1", name: "ATA", status: "In Progress", archivedAt: null, tasks: [] } as any] });
const run = (s: PlannerState, lastCommit: Record<string, number | null> = {}, prs: any[] = [], now = NOW) => evaluate({ s, now, lastCommit, prs });

test("stale at 7 days, dead weight at 14, quiet below", () => {
  const s = proj(emptyPlanner());
  assert.deepEqual(run(s, { p1: sec(3) }), []);
  assert.equal(run(s, { p1: sec(8) })[0].rule, "STALE_PROJECT");
  const dead = run(s, { p1: sec(20) });
  assert.equal(dead.length, 1);
  assert.equal(dead[0].rule, "DEAD_WEIGHT");
  assert.equal(dead[0].severity, "crit");
});

test("unknown commit time skips the rule; done and archived projects are ignored", () => {
  const s = proj(emptyPlanner());
  assert.deepEqual(run(s, { p1: null }), []);
  assert.deepEqual(run({ ...s, projects: [{ ...s.projects[0], status: "Done" }] }, { p1: sec(30) }), []);
  assert.deepEqual(run({ ...s, projects: [{ ...s.projects[0], archivedAt: "x" }] }, { p1: sec(30) }), []);
});

test("nothing in progress fires only when open cards exist and none is in Now", () => {
  let s = proj(emptyPlanner());
  assert.deepEqual(run(s), []);
  s = addCard(s, "p1", "Doors", "next");
  assert.equal(run(s)[0].rule, "NOTHING_IN_PROGRESS");
  s = moveCard(s, s.roadmapCards[0].id, "now");
  assert.deepEqual(run(s), []);
  s = moveCard(s, s.roadmapCards[0].id, "shipped");
  assert.deepEqual(run(s), []);
});

test("overdue card: past due only, never shipped ones", () => {
  let s = proj(emptyPlanner());
  s = addCard(s, "p1", "Late", "now");
  s.roadmapCards[0].dueDate = "2026-10-27";
  assert.equal(run(s)[0].rule, "OVERDUE_CARD");
  s.roadmapCards[0].dueDate = "2026-10-28";
  assert.deepEqual(run(s), []);
  s.roadmapCards[0].dueDate = "2026-10-01";
  s.roadmapCards[0].lane = "shipped";
  assert.deepEqual(run(s), []);
});

test("open PR waiting becomes a warning with its reason", () => {
  const r = run(emptyPlanner(), {}, [{ projectId: null, number: 41, title: "Retry", why: "checks failed" }]);
  assert.equal(r[0].rule, "PR_WAITING");
  assert.ok(r[0].reason.includes("checks failed"));
});

test("PRs with the same number in different repos stay separate signals", () => {
  const r = run(emptyPlanner(), {}, [
    { projectId: null, number: 12, url: "https://github.com/o/a/pull/12", title: "A", why: "x" },
    { projectId: null, number: 12, url: "https://github.com/o/b/pull/12", title: "B", why: "y" },
  ]);
  assert.equal(new Set(r.map((x) => x.id)).size, 2);
});

test("low score only in the evening and only with goals", () => {
  let s = addGoal(ensureDay(emptyPlanner(), "2026-10-28"), "2026-10-28", "x");
  assert.deepEqual(run(s), []);
  assert.equal(run(s, {}, [], new Date(2026, 9, 28, 19, 0))[0].rule, "LOW_SCORE");
  assert.deepEqual(run(emptyPlanner(), {}, [], new Date(2026, 9, 28, 19, 0)), []);
});

test("worst severity first", () => {
  let s = addCard(proj(emptyPlanner()), "p1", "x", "next");
  const r = run(s, { p1: sec(20) });
  assert.deepEqual(r.map((x) => x.severity), ["crit", "info"]);
});

test("snooze hides until the time passes; forever never returns", () => {
  const sig = run(proj(emptyPlanner()), { p1: sec(8) });
  let s = snooze(emptyPlanner(), sig[0].id, 86_400_000, 1000);
  assert.equal(visible(sig, s.snoozes, 1000 + 1000).length, 0);
  assert.equal(visible(sig, s.snoozes, 1000 + 86_400_001).length, 1);
  s = snooze(s, sig[0].id, FOREVER, 1000);
  assert.equal(visible(sig, s.snoozes, 1e14).length, 0);
});

test("briefing builds from goals, plan, waiting threads and signals; dismissing stores it", () => {
  let s = ensureDay(emptyPlanner(), "2026-10-27");
  s = addGoal(s, "2026-10-27", "Done thing");
  s.dailyGoalsByDate["2026-10-27"].goals[0].done = true;
  s.dailyGoalsByDate["2026-10-27"].score = 100;
  s = addGoal(ensureDay(s, "2026-10-28"), "2026-10-28", "Fix doors");
  const sig = run(proj(s), { p1: sec(20) });
  const text = briefing(s, sig, "2026-10-28", 2, "2026-10-27");
  assert.ok(text.includes("Yesterday: 100%") && text.includes('"Fix doors"') && text.includes("2 threads waiting") && text.includes("dead weight"));
  assert.ok(briefing(emptyPlanner(), [], "d", 0, "y").startsWith("A quiet start"));
  const fresh = dismissBriefing(emptyPlanner(), "d", "text");
  assert.equal(fresh.dailyBriefings.d.dismissed, true);
  assert.equal(fresh.dailyBriefings.d.content, "text");
});
