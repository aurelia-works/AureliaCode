import assert from "node:assert/strict";
import { test } from "node:test";
import { diffHash, mergeCouncil, nextRound, parseReport, roundCapped } from "./council.ts";

const A = `Correctness: FAIL - off by one
- [important] src/lib/a.ts:12 - the loop skips the last item
- [nit] src/lib/a.ts:30 - name could be clearer
- [pre-existing] src/old.ts:4 - this null check was already missing
SCORE: 6/10
VERDICT: fix`;

const B = `- [Important] \`src/lib/a.ts:14\` — last element never read
- [important] src/other.ts:9 - leaks a listener
SCORE: 8/10
VERDICT: ship`;

test("a reviewer's report gives its tagged findings, score and verdict", () => {
  const r = parseReport(A, "deepseek");
  assert.equal(r.score, 6);
  assert.equal(r.verdict, "fix");
  assert.deepEqual(
    r.findings.map((f) => [f.tag, f.file, f.line, f.text]),
    [
      ["important", "src/lib/a.ts", 12, "the loop skips the last item"],
      ["nit", "src/lib/a.ts", 30, "name could be clearer"],
      ["pre-existing", "src/old.ts", 4, "this null check was already missing"],
    ],
  );
  const b = parseReport(B, "kimi");
  assert.deepEqual(b.findings[0], { tag: "important", file: "src/lib/a.ts", line: 14, text: "last element never read", by: ["kimi"] });
  assert.equal(parseReport("nothing useful", "x").score, undefined);
});

test("a finding two reviewers both point at (same file, within 3 lines) is verified", () => {
  const c = mergeCouncil([parseReport(A, "deepseek"), parseReport(B, "kimi")]);
  assert.equal(c.reviewers, 2);
  assert.equal(c.score, 7);
  assert.equal(c.verdict, "fix", "the worst verdict wins");
  const verified = c.findings.filter((f) => f.verified);
  assert.equal(verified.length, 1);
  assert.deepEqual(verified[0].by, ["deepseek", "kimi"]);
  assert.equal(verified[0].file, "src/lib/a.ts");
  assert.equal(c.findings[0], verified[0], "verified findings come first");
  assert.equal(c.findings.length, 4);
});

test("one reviewer can't verify anything; failed reviewers don't count toward the score", () => {
  const c = mergeCouncil([parseReport(A, "deepseek"), { reviewer: "kimi", findings: [], failed: true }]);
  assert.equal(c.reviewers, 1);
  assert.equal(c.score, 6);
  assert.ok(c.findings.every((f) => !f.verified));
  assert.equal(mergeCouncil([]).score, undefined);
});

test("the round cap stops a review loop that keeps going", () => {
  assert.equal(roundCapped(2, 3), false);
  assert.equal(roundCapped(3, 3), true);
  assert.equal(roundCapped(9, 0), false, "0 means no cap");
});

test("rounds carry on only for another review of the same branch", () => {
  assert.equal(nextRound(undefined, "feat/a"), 1);
  assert.equal(nextRound({ rounds: 2, branch: "feat/a" }, "feat/a"), 3);
  assert.equal(nextRound({ rounds: 3, branch: "feat/a" }, "feat/b"), 1, "new branch, new count");
  assert.equal(nextRound({ rounds: 3, branch: undefined }, undefined), 4);
});

test("a cheap hash tells two diffs with the same line counts apart", () => {
  assert.notEqual(diffHash("-a\n+b"), diffHash("-a\n+c"));
  assert.equal(diffHash("x"), diffHash("x"));
});
