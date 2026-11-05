import assert from "node:assert/strict";
import { test } from "node:test";
import { humanStats, isBot } from "./humanStats.ts";

const h = (n: number) => new Date(Date.UTC(2026, 10, 1, n)).toISOString();
const prs = [
  {
    number: 10, title: "feat: one", body: "", author: { login: "jah" }, createdAt: h(0), mergedAt: h(5), labels: [],
    reviews: [
      { author: { login: "sam" }, state: "COMMENTED", submittedAt: h(2) },
      { author: { login: "sam" }, state: "APPROVED", submittedAt: h(4) },
      { author: { login: "coderabbitai[bot]" }, state: "APPROVED", submittedAt: h(1) },
    ],
    comments: [
      { author: { login: "jah" }, body: "<!-- pr-verdict -->\nVerdict: PASS", createdAt: h(3) },
      { author: { login: "sam" }, body: "nice", createdAt: h(3) },
    ],
  },
  {
    number: 11, title: "fix: two", body: "", author: { login: "jah" }, createdAt: h(0), mergedAt: h(1), labels: [{ name: "incident" }],
    reviews: [], comments: [{ author: { login: "github-actions", is_bot: true }, body: "size", createdAt: h(1) }],
  },
  { number: 12, title: "Revert \"feat: one\"", body: "Reverts aurelia-works/AureliaCode#10", author: { login: "jah" }, createdAt: h(6), mergedAt: h(7), labels: [], reviews: [], comments: [] },
  { number: 13, title: "Revert PR #11 (fix: two)", body: "", author: { login: "jah" }, createdAt: h(8), mergedAt: h(9), labels: [], reviews: [{ author: { login: "kim" }, state: "COMMENTED", submittedAt: h(14) }], comments: [] },
];

test("bots are told apart from people", () => {
  assert.equal(isBot({ login: "coderabbitai[bot]" }), true);
  assert.equal(isBot({ login: "github-actions", is_bot: true }), true);
  assert.equal(isBot({ login: "sam" }), false);
  assert.equal(isBot(undefined), true, "a deleted account (ghost) isn't a person we can count");
});

test("human and bot approvals and comments are counted apart, and marker comments count as bots", () => {
  const s = humanStats(prs);
  assert.equal(s.prs, 4);
  assert.equal(s.humanApprovals, 1);
  assert.equal(s.botApprovals, 1);
  assert.equal(s.humanComments, 1, "sam's comment; the <!-- pr-verdict --> comment was posted by a tool");
  assert.equal(s.botComments, 2);
  assert.equal(s.noHumanReview, 2, "#11 and #12 got no review or comment from a person");
});

test("wait on a person is the median time from open to a person's first review or comment", () => {
  // #10: first human touch at h2 (2h). #13: at h14 (6h). Median of [2h, 6h] = 4h.
  assert.equal(humanStats(prs).waitMedianMs, 4 * 3_600_000);
});

test("reverts and incidents are guardrail rates over the PRs that aren't themselves reverts", () => {
  const s = humanStats(prs);
  assert.deepEqual(s.reverted, [10, 11]);
  assert.equal(s.revertRate, 1, "both non-revert PRs were reverted");
  assert.equal(s.incidents, 1);
});

test("an empty list gives zeros, not NaN", () => {
  const s = humanStats([]);
  assert.equal(s.prs, 0);
  assert.equal(s.revertRate, 0);
  assert.equal(s.waitMedianMs, null);
});

test("a revert of a revert can't push the rate past 100%", () => {
  const at = new Date(0).toISOString();
  const pr = (number: number, title: string) => ({ number, title, createdAt: at, mergedAt: at });
  const s = humanStats([pr(1, "feat: a"), pr(2, "Revert PR #1"), pr(3, "Revert PR #2")]);
  assert.deepEqual(s.reverted, [1]);
  assert.equal(s.revertRate, 1);
});
