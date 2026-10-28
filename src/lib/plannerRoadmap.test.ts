import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyPlanner } from "./planner.ts";
import { addCard, cardPrompt, editCard, lanesFor, moveCard, newlySettled, removeCard, shipCard, startCard } from "./plannerRoadmap.ts";
import { ensureDay } from "./plannerToday.ts";

const withCard = () => {
  const s = addCard(emptyPlanner(), "p1", "Doors", "next");
  return { s, id: s.roadmapCards[0].id };
};

test("lanes group a project's cards and ignore others", () => {
  let { s } = withCard();
  s = addCard(s, "p2", "Other", "now");
  assert.equal(lanesFor(s, "p1").next.length, 1);
  assert.equal(lanesFor(s, "p1").now.length, 0);
  assert.equal(lanesFor(s, null).now.length, 1);
});

test("add, move, edit, remove", () => {
  let { s, id } = withCard();
  assert.equal(addCard(s, "p1", "  "), s);
  s = moveCard(s, id, "later");
  assert.equal(s.roadmapCards[0].lane, "later");
  s = editCard(s, id, { title: "Doors v2", description: "all of them" });
  assert.equal(cardPrompt(s.roadmapCards[0]), "Doors v2\n\nall of them");
  s = removeCard(s, id);
  assert.equal(s.roadmapCards.length, 0);
});

test("starting a thread moves next/later cards to now, never shipped ones", () => {
  let { s, id } = withCard();
  s = startCard(s, id);
  assert.equal(s.roadmapCards[0].lane, "now");
  s = moveCard(s, id, "shipped");
  assert.equal(startCard(s, id).roadmapCards[0].lane, "shipped");
});

test("settling the thread ships the card and ticks the linked goal", () => {
  let { s, id } = withCard();
  s = ensureDay({ ...s, goalTemplate: [{ id: "t", title: "Ship doors", category: "Build", points: 3, done: false, createdAt: "", completedAt: null }] }, "2026-10-28");
  const goalId = s.dailyGoalsByDate["2026-10-28"].goals[0].id;
  s = editCard(s, id, { goalId });
  s = shipCard(s, id, "NOW");
  assert.equal(s.roadmapCards[0].lane, "shipped");
  assert.equal(s.dailyGoalsByDate["2026-10-28"].goals[0].done, true);
  assert.equal(s.dailyGoalsByDate["2026-10-28"].score, 100);
  assert.equal(shipCard(s, id), s);
});

test("dragging a card to Shipped by hand ships it too: logs it once and ticks the goal", () => {
  let { s, id } = withCard();
  s = ensureDay({ ...s, goalTemplate: [{ id: "t", title: "Doors", category: "Build", points: 2, done: false, createdAt: "", completedAt: null }] }, "2026-10-28");
  s = editCard(s, id, { goalId: s.dailyGoalsByDate["2026-10-28"].goals[0].id });
  s = moveCard(s, id, "shipped", "NOW");
  assert.equal(s.dailyGoalsByDate["2026-10-28"].goals[0].done, true);
  assert.equal(s.activity.filter((a) => a.kind === "card-shipped").length, 1);
  s = moveCard(s, id, "shipped", "LATER");
  assert.equal(s.activity.length, 1);
  s = editCard(s, id, { title: "Renamed" });
  assert.equal(s.activity.length, 1);
});

test("moving a card to the lane it is in changes nothing; shipping skips closed days", () => {
  let { s, id } = withCard();
  assert.equal(moveCard(s, id, "next"), s);
  s = ensureDay({ ...s, goalTemplate: [{ id: "t", title: "G", category: "B", points: 1, done: false, createdAt: "", completedAt: null }] }, "2026-10-28");
  const gid = s.dailyGoalsByDate["2026-10-28"].goals[0].id;
  s = { ...s, dailyGoalsByDate: { "2026-10-28": { ...s.dailyGoalsByDate["2026-10-28"], isClosed: true } } };
  s = shipCard(editCard(s, id, { goalId: gid }), id);
  assert.equal(s.dailyGoalsByDate["2026-10-28"].goals[0].done, false);
});

test("newlySettled reports only threads that just settled", () => {
  const prev = { a: { cardId: "c1" }, b: { cardId: "c2", settled: true }, c: { settled: false } };
  const next = { a: { cardId: "c1", settled: true }, b: { cardId: "c2", settled: true }, c: { settled: true }, d: { cardId: "c4", settled: true } };
  assert.deepEqual(newlySettled(prev, next), ["c1"]);
  assert.deepEqual(newlySettled({}, next), [], "panes restored at startup are not newly settled");
});
