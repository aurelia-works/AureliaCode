import { test } from "node:test";
import assert from "node:assert/strict";
import { TURN_END_GAP_MS, timerDue, turnEndDue } from "./usageRefresh.ts";

test("a turn end reads usage unless a read just happened or is running", () => {
  const now = 1_000_000;
  assert.equal(turnEndDue(undefined, now, false), true);
  assert.equal(turnEndDue(now - TURN_END_GAP_MS, now, false), true);
  assert.equal(turnEndDue(now - 5_000, now, false), false);
  assert.equal(turnEndDue(now - 120_000, now, true), false);
});

test("a turn-end read pushes the timer's next read back", () => {
  const every = 120_000;
  const turnEndAt = 1_000_000;
  // The timer would have read at 1_050_000; the turn end read at 1_000_000 instead.
  assert.equal(timerDue(turnEndAt, turnEndAt + 50_000, every), false);
  assert.equal(timerDue(turnEndAt, turnEndAt + every, every), true);
});
