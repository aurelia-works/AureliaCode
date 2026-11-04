import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAT_CYCLE, PICKER_MODES, startPermissionMode } from "./startMode.ts";

// Jah, 2026-11-04: Auto-edit is gone; the modes are Manual, Plan, Auto and Bypass.
test("never chosen starts in Auto", () => {
  assert.equal(startPermissionMode(""), "auto");
  assert.equal(startPermissionMode(undefined), "auto");
});

test("a saved Auto-edit from before starts in Auto", () => {
  assert.equal(startPermissionMode("acceptEdits"), "auto");
});

test("an explicit choice is kept, and Manual passes no flag", () => {
  assert.equal(startPermissionMode("plan"), "plan");
  assert.equal(startPermissionMode("bypassPermissions"), "bypassPermissions");
  assert.equal(startPermissionMode("default"), undefined);
});

test("the pickers offer Manual, Plan, Auto and Bypass; Shift+Tab never lands on Bypass", () => {
  assert.deepEqual(PICKER_MODES, ["default", "plan", "auto", "bypassPermissions"]);
  assert.deepEqual(CHAT_CYCLE, ["default", "plan", "auto"]);
});
