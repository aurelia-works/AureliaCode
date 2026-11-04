import { test } from "node:test";
import assert from "node:assert/strict";
import { elapsedLabel, goalAction, goalKickoff, goalRound, judgeCheck, parseScore, shouldCheck, type Goal } from "./goalLoop.ts";

const goal = (over: Partial<Goal> = {}): Goal => ({ text: "Make the settings page pass axe", check: "npm run a11y", maxRounds: 3, startedAt: 0, deadline: 60_000, rounds: 0, ...over });

test("a score is read from the check's last SCORE line", () => {
  assert.equal(parseScore("SCORE: 7.5/10"), 7.5);
  assert.equal(parseScore("typography 9/10\nSCORE: 6 / 10\nnoise"), 6);
  assert.equal(parseScore("score 8.25/10"), 8.25);
  assert.equal(parseScore("SCORE: 4/10\nSCORE: 9/10"), 9);
  assert.equal(parseScore("all tests passed"), undefined);
  assert.equal(parseScore("SCORE: 12/10"), undefined);
});

test("without a target, exit 0 meets the goal", () => {
  assert.equal(judgeCheck(goal(), 0, "ok").met, true);
  assert.equal(judgeCheck(goal(), 1, "1 failing").met, false);
});

test("with a target, the score must reach it as well as exit 0", () => {
  const g = goal({ target: 8 });
  assert.deepEqual(judgeCheck(g, 0, "SCORE: 8/10"), { met: true, code: 0, score: 8, tail: "SCORE: 8/10" });
  assert.equal(judgeCheck(g, 0, "SCORE: 7.9/10").met, false);
  assert.equal(judgeCheck(g, 1, "SCORE: 9/10").met, false);
  // A check that prints no score can't meet a score target.
  assert.equal(judgeCheck(g, 0, "done").met, false);
});

test("the tail sent back is the end of the output, capped", () => {
  const long = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
  const { tail } = judgeCheck(goal(), 1, long);
  assert.ok(tail.length <= 3000);
  assert.ok(tail.endsWith("line 399"));
});

test("an unmet check wakes the agent with the output, until rounds or time run out", () => {
  const miss = judgeCheck(goal({ target: 8 }), 0, "SCORE: 6/10");
  const a = goalAction(goal({ target: 8, rounds: 0 }), miss, 10_000);
  assert.equal(a.kind, "wake");
  if (a.kind === "wake") {
    assert.match(a.text, /round 1 of 3/);
    assert.match(a.text, /6\/10, needs 8/);
    assert.match(a.text, /npm run a11y/);
    assert.match(a.text, /SCORE: 6\/10/);
  }
  assert.deepEqual(goalAction(goal({ rounds: 2 }), miss, 10_000), { kind: "stop", why: "rounds" });
  assert.deepEqual(goalAction(goal(), miss, 60_000), { kind: "stop", why: "time" });
  assert.deepEqual(goalAction(goal({ rounds: 2 }), judgeCheck(goal(), 0, ""), 99_999), { kind: "met" });
});

test("max rounds counts every attempt, the first turn included", () => {
  // 3 rounds: the kickoff turn and two wakes, so three checks in all.
  let g = goal({ maxRounds: 3 });
  const miss = judgeCheck(g, 1, "fail");
  const kinds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = goalAction(g, miss, 0);
    kinds.push(a.kind);
    if (a.kind !== "wake") break;
    g = { ...g, rounds: g.rounds + 1 };
  }
  assert.deepEqual(kinds, ["wake", "wake", "stop"]);
});

test("the round shown is the attempt, and doesn't move when the goal ends", () => {
  assert.equal(goalRound(goal({ rounds: 0 })), 1);
  assert.equal(goalRound(goal({ rounds: 0, ended: { at: 1, why: "met" } })), 1);
  assert.equal(goalRound(goal({ rounds: 2, ended: { at: 1, why: "rounds" } })), 3);
  assert.equal(goalRound(goal({ rounds: 9 })), 3);
});

test("a check left running by a stopped goal doesn't block the next goal", () => {
  const next = goal({ startedAt: 2 });
  // The old goal (startedAt 1) is still checking.
  assert.equal(shouldCheck(next, 1), true);
  assert.equal(shouldCheck(next, 2), false);
  assert.equal(shouldCheck(next, undefined), true);
  assert.equal(shouldCheck({ ...next, ended: { at: 3, why: "stopped" } }, undefined), false);
  assert.equal(shouldCheck(next, undefined, { outcome: "interrupted", queued: 0 }), false);
  assert.equal(shouldCheck(next, undefined, { outcome: "completed", queued: 1 }), false);
  assert.equal(shouldCheck(next, undefined, { outcome: "failed", queued: 0 }), true);
});

test("the kickoff says what done means and the budget", () => {
  const t = goalKickoff(goal({ target: 8, maxRounds: 8, deadline: 4 * 3600_000 }));
  for (const bit of ["Make the settings page pass axe", "`npm run a11y`", "exits 0", "SCORE: n/10", "at least 8", "8 rounds", "4h"]) assert.ok(t.includes(bit), bit);
});

test("elapsed time reads like a clock", () => {
  assert.equal(elapsedLabel(45_000), "45s");
  assert.equal(elapsedLabel(14 * 60_000), "14m");
  assert.equal(elapsedLabel(3 * 3600_000 + 48 * 60_000), "3h 48m");
});
