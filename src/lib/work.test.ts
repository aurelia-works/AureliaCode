import assert from "node:assert/strict";
import { test } from "node:test";
import { canTransition, groupBoard, migrateTasks, transition, workFromCard, type WorkItem } from "./work.ts";
import { afterPrMerge, afterTurnEnd, requestReview, settleWork, startWork } from "./workActions.ts";

const item = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: "w1",
  title: "Ship the board",
  project: "/repo/web",
  status: "pending",
  createdAt: 100,
  updatedAt: 100,
  ...over,
});

test("pending moves to working, then review, then done", () => {
  const working = transition(item(), "working");
  assert.equal(working.status, "working");
  assert.ok(working.updatedAt > 100);
  const review = transition(working, "review");
  assert.equal(review.status, "review");
  assert.equal(transition(review, "done").status, "done");
});

test("an illegal jump is refused and does not touch the item", () => {
  const pending = item();
  assert.throws(() => transition(pending, "done"), /cannot move work from pending to done/);
  assert.throws(() => transition(pending, "review"), /pending to review/);
  assert.equal(pending.status, "pending");
  assert.equal(canTransition("pending", "working"), true);
  assert.equal(canTransition("pending", "done"), false);
  assert.equal(canTransition("review", "working"), true, "changes requested goes back to work");
  assert.equal(canTransition("done", "review"), true, "a finished item can be reopened");
  assert.equal(transition(pending, "pending"), pending, "same status is a no-op");
});

test("groupBoard returns the four columns in board order", () => {
  const items = [
    item({ id: "a", status: "done" }),
    item({ id: "b", status: "pending" }),
    item({ id: "c", status: "working" }),
    item({ id: "d", status: "review" }),
    item({ id: "e", status: "pending" }),
  ];
  const columns = groupBoard(items);
  assert.deepEqual(columns.map((c) => c.status), ["pending", "working", "review", "done"]);
  assert.deepEqual(columns.map((c) => c.title), ["Pending", "In progress", "Review", "Done"]);
  assert.deepEqual(columns[0].items.map((i) => i.id), ["b", "e"]);
  assert.deepEqual(columns[1].items.map((i) => i.id), ["c"]);
  assert.deepEqual(columns[2].items.map((i) => i.id), ["d"]);
  assert.deepEqual(columns[3].items.map((i) => i.id), ["a"]);
});

test("migrateTasks keeps titles, statuses, projects and pane links", () => {
  const items = migrateTasks({
    "/repo/web": [
      { id: "t1", title: "Keyboard nav", status: "doing", paneId: "p2", createdAt: 10 },
      { id: "t2", title: "Fix focus test", status: "todo", createdAt: 20 },
    ],
    "/repo/api": [{ id: "t3", title: "Backfill org", status: "done", createdAt: 30 }],
  });
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((i) => [i.id, i.status, i.project, i.paneId]),
    [
      ["t1", "working", "/repo/web", "p2"],
      ["t2", "pending", "/repo/web", undefined],
      ["t3", "done", "/repo/api", undefined],
    ],
  );
  assert.equal(items[0].updatedAt, 10);
});

test("migrateTasks ignores junk instead of crashing", () => {
  const items = migrateTasks({ "/repo/web": [null as never, { title: "no id" } as never, { id: "ok", title: "Fine", status: "weird" }] });
  assert.deepEqual(items.map((i) => [i.id, i.status]), [["ok", "pending"]]);
});

test("a roadmap card becomes work, with the lane deciding done", () => {
  const card = { id: "c1", title: "Habit streaks", description: "Weekly view", lane: "next" };
  const pending = workFromCard(card, "/repo/web", 50);
  assert.equal(pending.id, "work-c1");
  assert.equal(pending.cardId, "c1");
  assert.equal(pending.status, "pending");
  assert.equal(pending.description, "Weekly view");
  assert.equal(pending.project, "/repo/web");
  assert.equal(pending.createdAt, 50);
  assert.equal(workFromCard({ ...card, lane: "shipped" }, "/repo/web").status, "done");
});

test("turn end sends a working item to review, except an interruption", () => {
  const working = item({ status: "working" });
  assert.equal(afterTurnEnd(working, "completed").status, "review");
  assert.equal(afterTurnEnd(working, "failed").status, "review");
  assert.equal(afterTurnEnd(working, "interrupted").status, "working");
  const pending = item();
  assert.equal(afterTurnEnd(pending, "completed"), pending, "a pending item is not working");
});

test("start, review, merge and settle move only where they should", () => {
  assert.equal(startWork(item()).status, "working");
  assert.equal(startWork(item({ status: "review" })).status, "review");
  assert.equal(requestReview(item({ status: "working" })).status, "review");
  assert.equal(requestReview(item()).status, "pending");
  assert.equal(afterPrMerge(item({ status: "working" })).status, "done");
  assert.equal(afterPrMerge(item({ status: "done" })).status, "done");
  const settled = settleWork(item({ status: "review", updatedAt: 900 }));
  assert.equal(settled.status, "done");
  assert.ok(settled.updatedAt > 900);
});
