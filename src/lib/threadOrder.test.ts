import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalPanes, chatIcon, cleanTitle, pinPatch, queueSessions, settlePatch, shouldRecede, splitPinned, stepFocus } from "./threadOrder.ts";

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

test("the Queue rail leaves settled threads out; live ones stay", () => {
  const sessions = { a: { paneId: "a" }, b: { paneId: "b" }, c: { paneId: "c" } };
  const panes = { a: { settled: true }, b: {}, c: undefined };
  assert.deepEqual(queueSessions(sessions, panes).map((s) => s.paneId), ["b", "c"]);
});

test("a working thread you aren't looking at recedes; one that needs you or is open never does", () => {
  assert.equal(shouldRecede({ v: "working", focused: false, selected: false }), true);
  assert.equal(shouldRecede({ v: "starting", focused: false, selected: false }), true);
  assert.equal(shouldRecede({ v: "working", focused: true, selected: false }), false);
  assert.equal(shouldRecede({ v: "working", focused: false, selected: true }), false);
  assert.equal(shouldRecede({ v: "needs_input", focused: false, selected: false }), false);
  assert.equal(shouldRecede({ v: "done", focused: false, selected: false }), false);
  assert.equal(shouldRecede({ v: undefined, focused: false, selected: false }), false);
});

test("a chat with a pending approval needs you, whatever its turn status says", () => {
  assert.equal(chatIcon("working", 1), "needs_input");
  assert.equal(chatIcon("waiting", 2), "needs_input");
  assert.equal(chatIcon("working", 0), "working");
  assert.equal(chatIcon("waiting", 0), "working");
  assert.equal(chatIcon("starting", 0), "starting");
  assert.equal(chatIcon("idle", 0), "idle");
  assert.equal(chatIcon(undefined, 0), "idle");
});

test("chats with a pending approval are listed, so the sidebar groups them under Needs you", () => {
  const byPane = { a: { approvals: [1] }, b: { approvals: [] }, c: { approvals: [1, 2] } };
  assert.deepEqual(approvalPanes(byPane), ["a", "c"]);
  assert.deepEqual(approvalPanes({}), []);
});
