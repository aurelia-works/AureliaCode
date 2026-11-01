import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureDay, toggleGoal } from "./plannerToday.ts";
import { emptyPlanner, ImportError, importLinkra, normalizePlanner, plannerCounts } from "./planner.ts";

const goal = (id: string, done = false) => ({ id, title: `g${id}`, category: "Build", points: 3, done, createdAt: "2026-03-06T00:00:00Z", completedAt: null });

const bundle = () => ({
  schema_version: 3,
  created_at: "2026-03-06T00:00:00Z",
  data: {
    metadata: { schema_version: 3, created_at: "2026-03-06T00:00:00Z" },
    userSettings: { goalTemplate: [goal("t1")], githubPat: "ghp_secret", selectedRepos: [{ repo: "a/b", branch: "main" }], stripeCustomerId: "cus_1" },
    projects: [{ id: "p1", name: "Linkra", githubRepo: "Jahrix/LinkraHQ", localRepoPath: "/x/linkra", createdAt: "a", updatedAt: "b", tasks: [{ id: "k1", text: "do it", done: true, createdAt: "a", completedAt: "b" }] }],
    localRepos: [{ id: "r1" }],
    dailyGoalsByDate: { "2026-03-06": { date: "2026-03-06", goals: [goal("g1", true)], score: 3, completedPoints: 3, totalPoints: 3, isClosed: false, archivedAt: null } },
    roadmapCards: [{ id: "c1", lane: "now", title: "Card", linkedRepo: null, dueDate: null, project: "p1", createdAt: "a", updatedAt: "b" }],
    focusSessions: [{ id: "f1", startedAt: "a", durationMinutes: 45, completedAt: null }],
    todayPlanByDate: { "2026-03-06": { taskIds: ["k1"], generatedAt: "a", source: "manual", notes: null } },
    dailyBriefings: { "2026-03-06": { date: "2026-03-06", content: "hi", generatedAt: "a" } },
    weeklyReviews: [{ id: "w1", markdown: "# week" }],
    habits: [{ id: "h1", title: "Read", createdAt: "a", updatedAt: "b" }],
    habitCompletions: [{ id: "hc1", habitId: "h1", date: "2026-03-06", createdAt: "a" }],
    github: { loggedIn: true },
  },
});

const count = (s: ReturnType<typeof emptyPlanner>, key: string) => plannerCounts(s).find((c) => c.key === key)!.count;

test("imports every kind and counts it", () => {
  const s = importLinkra(bundle(), emptyPlanner(), "NOW");
  assert.equal(s.importedAt, "NOW");
  assert.equal(count(s, "projects"), 1);
  assert.equal(s.projects[0].tasks[0].status, "done");
  assert.equal(count(s, "dailyGoalsByDate"), 1);
  assert.equal(count(s, "goalTemplate"), 1);
  assert.equal(count(s, "roadmapCards"), 1);
  assert.equal(count(s, "focusSessions"), 1);
  assert.equal(count(s, "habits"), 1);
  assert.equal(count(s, "habitCompletions"), 1);
  assert.equal(count(s, "weeklyReviews"), 1);
  assert.equal(count(s, "todayPlanByDate"), 1);
  assert.equal(count(s, "dailyBriefings"), 1);
});

test("drops tokens, billing and the repo scan cache", () => {
  const text = JSON.stringify(importLinkra(bundle()));
  assert.ok(!text.includes("ghp_secret"));
  assert.ok(!text.includes("cus_1"));
  assert.ok(!text.includes("selectedRepos"));
  assert.ok(!text.includes("localRepos"));
});

test("importing twice changes nothing but the timestamp", () => {
  const once = importLinkra(bundle(), emptyPlanner(), "T");
  const twice = importLinkra(bundle(), once, "T");
  assert.deepEqual(twice, once);
});

test("a re-import adds what is missing and keeps local edits, today's ticks and card state", () => {
  const once = importLinkra(bundle());
  const edited = {
    ...once,
    habits: [...once.habits, { ...once.habits[0], id: "mine", title: "Mine" }],
    roadmapCards: once.roadmapCards.map((c) => ({ ...c, lane: "shipped" as const, goalId: "g1" })),
    dailyGoalsByDate: { ...once.dailyGoalsByDate, "2026-03-06": { ...once.dailyGoalsByDate["2026-03-06"], score: 99 } },
  };
  const b = bundle();
  b.data.habits[0].title = "Read more";
  b.data.habits.push({ id: "h2", title: "New", createdAt: "a", updatedAt: "b" });
  const s = importLinkra(b, edited);
  assert.equal(s.habits.length, 3);
  assert.equal(s.habits.find((h) => h.id === "h1")!.title, "Read");
  assert.equal(s.roadmapCards[0].lane, "shipped");
  assert.equal(s.roadmapCards[0].goalId, "g1");
  assert.equal(s.dailyGoalsByDate["2026-03-06"].score, 99);
});

test("an untouched template day gives way to the imported day; a touched one stays; a customised template stays", () => {
  const b = bundle();
  const pristine = ensureDay({ ...emptyPlanner(), goalTemplate: [goal("t1")] }, "2026-03-06");
  const s1 = importLinkra(b, pristine);
  assert.equal(s1.dailyGoalsByDate["2026-03-06"].goals[0].id, "g1");
  const touched = toggleGoal(pristine, "2026-03-06", "2026-03-06-t0");
  assert.equal(importLinkra(b, touched).dailyGoalsByDate["2026-03-06"].goals[0].id, "2026-03-06-t0");
  const mine = { ...emptyPlanner(), goalTemplate: [{ ...goal("mine"), title: "My template goal" }] };
  assert.equal(importLinkra(b, mine).goalTemplate[0].title, "My template goal");
});

test("adopting the imported template rebuilds an empty local day; a closed one stays", () => {
  const b = bundle();
  b.data.dailyGoalsByDate = {};
  const empty = ensureDay(emptyPlanner(), "2026-10-28"); // built before any template existed
  const closed = { ...empty, dailyGoalsByDate: { ...empty.dailyGoalsByDate, "2026-10-27": { ...empty.dailyGoalsByDate["2026-10-28"], date: "2026-10-27", isClosed: true } } };
  const s = importLinkra(b, closed);
  assert.equal("2026-10-28" in s.dailyGoalsByDate, false, "ensureDay will rebuild it from the new template");
  assert.equal(s.dailyGoalsByDate["2026-10-27"].isClosed, true);
  assert.equal(ensureDay(s, "2026-10-28").dailyGoalsByDate["2026-10-28"].goals.length, 1);
});

test("keeps the dev-panel switches across an import", () => {
  const base = emptyPlanner();
  base.switches.habits = false;
  assert.equal(importLinkra(bundle(), base).switches.habits, false);
});

test("rejects things that are not a v3 export", () => {
  assert.throws(() => importLinkra({ nope: 1 }), ImportError);
  assert.throws(() => importLinkra({ schema_version: 2, data: {} }), /not supported/);
  assert.throws(() => importLinkra(null), ImportError);
});

test("tolerates malformed items instead of crashing", () => {
  const b = bundle() as any;
  b.data.roadmapCards = [null, 5, { id: "x", lane: "bogus", title: 7 }];
  const s = importLinkra(b);
  assert.equal(s.roadmapCards.length, 1);
  assert.equal(s.roadmapCards[0].lane, "later");
});

test("normalizePlanner fills a partial or wrong-typed saved file", () => {
  assert.deepEqual(normalizePlanner(null), emptyPlanner());
  const s = normalizePlanner({ habits: "oops", switches: { today: false } });
  assert.deepEqual(s.habits, []);
  assert.equal(s.switches.today, false);
  assert.equal(s.switches.roadmap, true);
});
