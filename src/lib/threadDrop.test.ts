import assert from "node:assert/strict";
import { test } from "node:test";
import { dropPlan, pinKeyBefore, zoneOf } from "./threadDrop.ts";

test("a thread's zone", () => {
  assert.equal(zoneOf({}), "active");
  assert.equal(zoneOf({ pinned: 5 }), "pinned");
  assert.equal(zoneOf({ pinned: 5, snoozed: true }), "snoozed");
  assert.equal(zoneOf({ pinned: 5, settled: true }), "settled");
});

test("dropping into pinned pins; from settled it also wakes", () => {
  assert.deepEqual(dropPlan("active", "pinned", 9), { patch: { pinned: 9, settled: false, snoozedUntil: undefined }, verb: "Pinned", label: "Pin" });
  assert.equal(dropPlan("settled", "pinned", 9)!.label, "Wake and pin");
});

test("dropping onto settled settles and drops the pin", () => {
  const p = dropPlan("pinned", "settled", 1)!;
  assert.equal(p.patch.settled, true);
  assert.ok("pinned" in p.patch && p.patch.pinned === undefined);
});

test("dropping into active unpins a pinned thread and wakes a parked one", () => {
  assert.equal(dropPlan("pinned", "active", 1)!.label, "Unpin");
  assert.equal(dropPlan("settled", "active", 1)!.label, "Un-settle");
  assert.equal(dropPlan("snoozed", "active", 1)!.label, "Wake");
  assert.deepEqual(dropPlan("snoozed", "active", 1)!.patch, { settled: false, snoozedUntil: undefined });
});

test("no plan for the same section or for snoozing by drag", () => {
  assert.equal(dropPlan("active", "active", 1), null);
  assert.equal(dropPlan("pinned", "pinned", 1), null);
  assert.equal(dropPlan("active", "snoozed", 1), null);
  assert.equal(dropPlan("settled", "snoozed", 1), null);
});

test("pin keys: before a neighbour is their midpoint, first goes below the first, last goes after", () => {
  const order = [{ id: "a", pinned: 10 }, { id: "b", pinned: 20 }, { id: "c", pinned: 30 }];
  assert.equal(pinKeyBefore(order, "x", "b", 100), 15);
  assert.equal(pinKeyBefore(order, "x", "a", 100), 9, "before the first: between first-2 and first");
  assert.equal(pinKeyBefore(order, "x", null, 5), 31);
  assert.equal(pinKeyBefore(order, "c", "b", 100), 15, "moving c up past b ignores c itself");
  assert.equal(pinKeyBefore(order, "a", "b", 100), 19, "a dragged before b: a is ignored, b becomes the first");
});
