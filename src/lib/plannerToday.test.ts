import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyPlanner } from "./planner.ts";
import { isWithin, projectForDir, addGoal, addPlanItem, capture, ensureDay, localDate, movePlanItem, moveGoal, parsePlanText, planItems, planPrompt, removeGoal, toggleGoal, togglePlanItem, writePlan } from "./plannerToday.ts";

const tpl = () => {
  const s = emptyPlanner();
  s.goalTemplate = [
    { id: "t1", title: "Ship", category: "Build", points: 3, done: true, createdAt: "x", completedAt: "x" },
    { id: "t2", title: "Log", category: "Review", points: 2, done: false, createdAt: "x", completedAt: null },
  ];
  return s;
};

test("localDate uses the local calendar day, not UTC", () => {
  assert.equal(localDate(new Date(2026, 9, 28, 23, 59)), "2026-10-28");
  assert.equal(localDate(new Date(2026, 0, 5, 0, 1)), "2026-01-05");
});

test("a new day refills from the template, undone, and rolls over once", () => {
  const a = ensureDay(tpl(), "2026-10-28");
  const day = a.dailyGoalsByDate["2026-10-28"];
  assert.equal(day.goals.length, 2);
  assert.ok(day.goals.every((g) => !g.done && g.completedAt === null));
  assert.equal(day.totalPoints, 5);
  assert.equal(ensureDay(a, "2026-10-28"), a);
  const b = ensureDay(toggleGoal(a, "2026-10-28", "2026-10-28-t0"), "2026-10-29");
  assert.ok(b.dailyGoalsByDate["2026-10-29"].goals.every((g) => !g.done));
  assert.equal(b.dailyGoalsByDate["2026-10-28"].completedPoints, 3);
});

test("ticking scores the day and unticking undoes it", () => {
  let s = ensureDay(tpl(), "d");
  s = toggleGoal(s, "d", "d-t0");
  assert.equal(s.dailyGoalsByDate.d.score, 60);
  s = toggleGoal(s, "d", "d-t0");
  assert.equal(s.dailyGoalsByDate.d.score, 0);
});

test("add, remove and reorder goals", () => {
  let s = addGoal(ensureDay(tpl(), "d"), "d", "  New one ", { points: 5 });
  assert.equal(s.dailyGoalsByDate.d.goals.length, 3);
  assert.equal(addGoal(s, "d", "   "), s);
  s = moveGoal(s, "d", s.dailyGoalsByDate.d.goals[2].id, -1);
  assert.equal(s.dailyGoalsByDate.d.goals[1].title, "New one");
  assert.equal(moveGoal(s, "d", s.dailyGoalsByDate.d.goals[0].id, -1).dailyGoalsByDate.d.goals[0].title, "Ship");
  s = removeGoal(s, "d", s.dailyGoalsByDate.d.goals[1].id);
  assert.equal(s.dailyGoalsByDate.d.goals.length, 2);
});

test("plan items add, tick, move", () => {
  let s = addPlanItem(emptyPlanner(), "d", "one");
  s = addPlanItem(s, "d", "two");
  s = movePlanItem(s, "d", planItems(s, "d")[1].id, -1);
  assert.deepEqual(planItems(s, "d").map((i) => i.text), ["two", "one"]);
  s = togglePlanItem(s, "d", planItems(s, "d")[0].id);
  assert.equal(planItems(s, "d")[0].done, true);
});

test("parsePlanText strips list markers and headings", () => {
  assert.deepEqual(parsePlanText("# Plan\n1. Fix login\n2) [ ] Write tests\n- Review PR\n\n* [x] Lunch"), ["Fix login", "Write tests", "Review PR", "Lunch"]);
});

test("writePlan replaces the queue and marks it auto", () => {
  const s = writePlan(addPlanItem(emptyPlanner(), "d", "old"), "d", "1. a\n2. b");
  assert.deepEqual(planItems(s, "d").map((i) => i.text), ["a", "b"]);
  assert.equal(s.todayPlanByDate.d.source, "auto");
});

test("planPrompt lists open goals and project tasks only", () => {
  let s = ensureDay(tpl(), "d");
  s = toggleGoal(s, "d", "d-t0");
  s = capture({ ...s, projects: [{ id: "p", name: "ATA", tasks: [], archivedAt: null } as any] }, { projectId: "p" }, "Fix doors", "d");
  const p = planPrompt(s, "d", ["10:00 Standup"]);
  assert.ok(p.includes("- Log (2 pts)") && !p.includes("Ship"));
  assert.ok(p.includes("[ATA] Fix doors") && p.includes("10:00 Standup"));
});

test("adding a goal to a day that has no entry yet still brings the template", () => {
  const s = addGoal(tpl(), "2026-10-28", "Extra");
  assert.deepEqual(s.dailyGoalsByDate["2026-10-28"].goals.map((g) => g.title), ["Ship", "Log", "Extra"]);
  assert.equal(ensureDay(s, "2026-10-28"), s);
});

test("a thread's folder belongs to a project by whole path segments, deepest first", () => {
  const ps = [{ id: "app", localRepoPath: "/dev/app" }, { id: "sub", localRepoPath: "/dev/app/sub" }, { id: "none", localRepoPath: null }];
  const id = (d: string) => projectForDir(ps, d, (p) => p)?.id;
  assert.equal(id("/dev/app"), "app");
  assert.equal(id("/dev/app/src"), "app");
  assert.equal(id("/dev/app-two"), undefined);
  assert.equal(id("/dev/app/sub/x"), "sub");
  assert.equal(isWithin("/dev/app/", "/dev/app/"), true);
});

test("capture goes to today or to a project, and ignores empty text", () => {
  const s = emptyPlanner();
  assert.equal(capture(s, "today", " ", "d"), s);
  assert.equal(capture(s, "today", "call", "d").dailyGoalsByDate.d.goals[0].title, "call");
  const withP = { ...s, projects: [{ id: "p", name: "A", tasks: [] } as any] };
  assert.equal(capture(withP, { projectId: "p" }, "x", "d").projects[0].tasks[0].text, "x");
});
