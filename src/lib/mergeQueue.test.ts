import assert from "node:assert/strict";
import { test } from "node:test";
import { active, advance, CHECKS_TIMEOUT_MS, enqueue, NONE_GRACE_MS, verdictFor, type QueueItem } from "./mergeQueue.ts";

const item = (paneId: string, stage: QueueItem["stage"] = "queued"): QueueItem => ({ paneId, pr: 1, stage, at: 0 });

test("one PR moves at a time, in the order they joined", () => {
  let q = enqueue([], "a", 1, 0);
  q = enqueue(q, "b", 2, 1);
  q = enqueue(q, "a", 1, 2);
  assert.deepEqual(q.map((i) => i.paneId), ["a", "b"], "joining twice keeps one place");
  assert.equal(active(q)?.paneId, "a");
  q = q.map((i) => (i.paneId === "a" ? { ...i, stage: "merged" as const } : i));
  assert.equal(active(q)?.paneId, "b");
});

test("the happy path: sync, green checks, a PASS for this commit, merge", () => {
  let i = advance(item("a"), { type: "start" });
  assert.equal(i.stage, "syncing");
  i = advance(i, { type: "synced", sha: "abc" });
  assert.equal(i.stage, "checks");
  assert.equal(advance(i, { type: "checks", checks: "pending" }).stage, "checks");
  i = advance(i, { type: "checks", checks: "pass" });
  assert.equal(i.stage, "verdict");
  i = advance(i, { type: "verdict", verdict: "PASS" });
  assert.equal(i.stage, "merging");
  assert.equal(advance(i, { type: "merged" }).stage, "merged");
});

test("a conflict, red checks, a FAIL or a missing verdict send it back to you", () => {
  assert.deepEqual(pick(advance(item("a", "syncing"), { type: "conflict" })), { stage: "bounced", reason: "Rebasing on the base branch conflicts" });
  assert.deepEqual(pick(advance({ ...item("a", "checks"), sha: "abc" }, { type: "checks", checks: "fail", failing: ["web", "rust"] })), { stage: "bounced", reason: "Checks failed: web, rust" });
  assert.deepEqual(pick(advance(item("a", "verdict"), { type: "verdict", verdict: "FAIL" })), { stage: "bounced", reason: "The reviewer said FAIL for this commit" });
  assert.deepEqual(pick(advance(item("a", "verdict"), { type: "verdict", verdict: null })), { stage: "bounced", reason: "No reviewer verdict for this commit: run verify-pr first" });
  assert.deepEqual(pick(advance(item("a", "merging"), { type: "error", message: "gh: not mergeable" })), { stage: "bounced", reason: "gh: not mergeable" });
});

test("no checks at all counts as green, a merged PR finishes early", () => {
  assert.equal(advance(item("a", "checks"), { type: "checks", checks: "none" }).stage, "verdict");
  assert.equal(advance(item("a", "checks"), { type: "prMerged" }).stage, "merged");
});

test("an event for the wrong stage changes nothing", () => {
  const i = item("a", "checks");
  assert.equal(advance(i, { type: "merged" }), i);
  const done = item("a", "merged");
  assert.equal(advance(done, { type: "start" }), done);
});

test("the verdict must name this exact head commit; the latest one wins", () => {
  const c = (body: string) => ({ body });
  const comments = [
    c("<!-- pr-verdict -->\nVerdict: PASS for aaa1111\nReviewer: x"),
    c("looks good"),
    c("<!-- pr-verdict -->\nVerdict: FAIL for bbb2222\nReviewer: y"),
    c("<!-- pr-verdict -->\nVerdict: PASS for bbb2222\nReviewer: y"),
  ];
  assert.equal(verdictFor(comments, "bbb2222"), "PASS");
  assert.equal(verdictFor(comments, "aaa1111"), "PASS");
  assert.equal(verdictFor(comments, "ccc3333"), null);
  assert.equal(verdictFor([c("Verdict: PASS for bbb2222")], "bbb2222"), null, "without the marker it's just a comment");
});

const pick = (i: QueueItem) => ({ stage: i.stage, reason: i.reason });

test("right after a push, 'no checks' isn't green yet: CI may not have started", () => {
  const i = { ...item("a", "checks"), sha: "abc1234" };
  assert.equal(advance(i, { type: "checks", checks: "none", sinceSyncMs: 10_000 }).stage, "checks");
  assert.equal(advance(i, { type: "checks", checks: "none", sinceSyncMs: NONE_GRACE_MS }).stage, "verdict");
  assert.equal(advance(i, { type: "checks", checks: "pass", sinceSyncMs: 1_000 }).stage, "verdict", "a real pass needs no wait");
});

test("checks stuck pending for an hour send it back instead of blocking the queue", () => {
  const i = { ...item("a", "checks"), sha: "abc1234" };
  assert.equal(advance(i, { type: "checks", checks: "pending", sinceSyncMs: 10 * 60_000 }).stage, "checks");
  const out = advance(i, { type: "checks", checks: "pending", sinceSyncMs: CHECKS_TIMEOUT_MS });
  assert.equal(out.stage, "bounced");
  assert.match(out.reason!, /still running after/);
});
