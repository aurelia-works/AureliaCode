import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyNav, NAV_CAP, prune, step, visit } from "./navHistory.ts";

const all = () => true;

test("visiting builds a trail and ignores the same thread twice", () => {
  let h = visit(visit(visit(emptyNav(), "a"), "b"), "c");
  assert.deepEqual(h, { stack: ["a", "b", "c"], at: 2 });
  assert.equal(visit(h, "c"), h);
});

test("back and forward walk the trail and stop at the ends", () => {
  let h = visit(visit(visit(emptyNav(), "a"), "b"), "c");
  let r = step(h, -1, all);
  assert.equal(r.id, "b");
  r = step(r.h, -1, all);
  assert.equal(r.id, "a");
  assert.equal(step(r.h, -1, all).id, null);
  r = step(r.h, 1, all);
  assert.equal(r.id, "b");
  assert.equal(step(step(r.h, 1, all).h, 1, all).id, null);
});

test("visiting after going back drops the forward part", () => {
  let h = visit(visit(visit(emptyNav(), "a"), "b"), "c");
  h = step(h, -1, all).h;
  h = visit(h, "d");
  assert.deepEqual(h.stack, ["a", "b", "d"]);
  assert.equal(step(h, 1, all).id, null);
});

test("closed threads are skipped going back or forward", () => {
  const h = visit(visit(visit(emptyNav(), "a"), "b"), "c");
  assert.equal(step(h, -1, (id) => id !== "b").id, "a");
  const back = step(h, -1, all).h;
  assert.equal(step(step(back, -1, all).h, 1, (id) => id !== "b").id, "c");
});

test("the trail is capped and pruned of closed threads", () => {
  let h = emptyNav();
  for (let i = 0; i < NAV_CAP + 10; i++) h = visit(h, `t${i}`);
  assert.equal(h.stack.length, NAV_CAP);
  assert.equal(h.stack.at(-1), `t${NAV_CAP + 9}`);
  const p = prune({ stack: ["a", "b", "c"], at: 1 }, (id) => id !== "a");
  assert.deepEqual(p, { stack: ["b", "c"], at: 0 });
  assert.deepEqual(prune({ stack: ["a"], at: 0 }, () => false), { stack: [], at: -1 });
});
