import assert from "node:assert/strict";
import { test } from "node:test";
import { diffGrowth, isReady, proofOf, sameStat, scrapSeed } from "./proof.ts";

const stat = { files: 2, additions: 40, deletions: 5 };

test("no goal and no review: no proof yet", () => {
  const p = proofOf({ bar: 8 });
  assert.equal(p.ok, false);
  assert.match(p.text, /No proof yet/);
});

test("a met goal check is proof", () => {
  const p = proofOf({ bar: 8, goal: { check: "npm test", ended: { why: "met" } } });
  assert.deepEqual(p, { ok: true, text: "Check passed: npm test" });
  const failing = proofOf({ bar: 8, goal: { check: "npm test", last: { met: false, code: 1 } } });
  assert.equal(failing.ok, false);
  assert.equal(failing.text, "Check failing: npm test exited 1");
});

test("a council review at or above the bar is proof until the diff changes", () => {
  const review = { score: 8.5, verdict: "ship" as const, important: 0, stat };
  assert.deepEqual(proofOf({ bar: 8, review, stat }), { ok: true, text: "Council 8.5/10, no verified important findings" });
  assert.equal(proofOf({ bar: 9, review, stat }).ok, false, "below the bar");
  assert.equal(proofOf({ bar: 8, review: { ...review, important: 1 }, stat }).ok, false, "a verified important finding blocks it");
  const moved = proofOf({ bar: 8, review, stat: { ...stat, additions: 60 } });
  assert.equal(moved.ok, false);
  assert.match(moved.text, /changed since/);
});

test("only a finished or idle thread with proof is Ready", () => {
  const ok = { ok: true, text: "" };
  assert.equal(isReady("done", ok), true);
  assert.equal(isReady("idle", ok), true);
  assert.equal(isReady("working", ok), false);
  assert.equal(isReady("needs_input", ok), false);
  assert.equal(isReady("done", { ok: false, text: "" }), false);
});

test("the tripwire fires when a diff more than doubles and grows by 200+ lines", () => {
  assert.equal(diffGrowth(undefined, stat), null);
  assert.equal(diffGrowth(stat, { ...stat, additions: 80 }), null, "doubled but small");
  assert.deepEqual(diffGrowth({ files: 3, additions: 100, deletions: 20 }, { files: 9, additions: 400, deletions: 60 }), { from: 120, to: 460, factor: 3.8 });
  assert.equal(diffGrowth({ files: 1, additions: 5, deletions: 0 }, { files: 4, additions: 400, deletions: 0 }), null, "a baseline under 20 lines says nothing");
});

test("scrapping keeps the brief and says deleting the last try is fine", () => {
  const s = scrapSeed("Add dark mode to the settings page");
  assert.match(s, /Add dark mode to the settings page/);
  assert.match(s, /delete/i);
});

test("sameStat compares files and line counts", () => {
  assert.equal(sameStat(stat, { ...stat }), true);
  assert.equal(sameStat(stat, { ...stat, deletions: 6 }), false);
  assert.equal(sameStat(null, undefined), true);
});
