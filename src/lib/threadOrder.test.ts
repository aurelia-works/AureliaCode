import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanTitle, pinPatch, settlePatch, splitPinned, stepFocus } from "./threadOrder.ts";

test("pinned threads come first in pin order; the rest keep their order", () => {
  const panes = { a: {}, b: { pinned: 20 }, c: { pinned: 10 }, d: {} };
  assert.deepEqual(splitPinned(["a", "b", "c", "d"], panes), { pinned: ["c", "b"], rest: ["a", "d"] });
  assert.deepEqual(splitPinned([], panes), { pinned: [], rest: [] });
});

test("pin and unpin patches; settling drops the pin", () => {
  assert.deepEqual(pinPatch(true, 5), { pinned: 5 });
  assert.deepEqual(pinPatch(false, 5), { pinned: undefined });
  assert.deepEqual(settlePatch(), { settled: true, pinned: undefined });
  assert.ok("pinned" in settlePatch());
});

test("keyboard stepping stops at both ends", () => {
  assert.equal(stepFocus(3, -1, "ArrowDown"), 0);
  assert.equal(stepFocus(3, 0, "ArrowDown"), 1);
  assert.equal(stepFocus(3, 2, "ArrowDown"), 2);
  assert.equal(stepFocus(3, 0, "ArrowUp"), 0);
  assert.equal(stepFocus(3, 2, "ArrowUp"), 1);
  assert.equal(stepFocus(3, 1, "Home"), 0);
  assert.equal(stepFocus(3, 1, "End"), 2);
  assert.equal(stepFocus(0, -1, "ArrowDown"), -1);
  assert.equal(stepFocus(3, 1, "x"), 1);
});

test("a typed title is tidied; empty clears it", () => {
  assert.equal(cleanTitle("  Fix   the\ndoors "), "Fix the doors");
  assert.equal(cleanTitle("   "), undefined);
  assert.equal(cleanTitle("x".repeat(200))!.length, 80);
});
