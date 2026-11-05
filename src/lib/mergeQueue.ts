/**
 * Merge queue (Theo, 2026-11-04 02:02: "We probably need a merge queue at this point"). Ready threads with a PR merge
 * one at a time: rebase on the base branch and push, wait for checks, require a reviewer PASS for that exact commit
 * (the verify-pr verdict, the same rule as merge-gate.sh), then squash-merge. Anything off sends it back to you.
 * This file is the pure state machine; store/mergeQueue.ts does the work.
 */

export type Stage = "queued" | "syncing" | "checks" | "verdict" | "merging" | "merged" | "bounced";

export interface QueueItem {
  paneId: string;
  pr: number;
  stage: Stage;
  /** When it joined. */
  at: number;
  /** The head commit after syncing: the one checks and the verdict must be for. */
  sha?: string;
  /** Why it was sent back. */
  reason?: string;
}

export type QueueEvent =
  | { type: "start" }
  | { type: "synced"; sha: string }
  | { type: "conflict" }
  | { type: "checks"; checks: "none" | "pending" | "pass" | "fail"; failing?: string[]; sinceSyncMs?: number }
  | { type: "verdict"; verdict: "PASS" | "FAIL" | null }
  | { type: "merged" }
  | { type: "prMerged" }
  | { type: "error"; message: string };

export const DONE: Stage[] = ["merged", "bounced"];

/** Right after a push GitHub may not have started any checks yet; "none" only counts as green after this long. */
export const NONE_GRACE_MS = 90_000;
/** Checks still pending this long after the push send it back, so one stuck run can't hold up the queue. */
export const CHECKS_TIMEOUT_MS = 60 * 60_000;

export function enqueue(q: QueueItem[], paneId: string, pr: number, at: number): QueueItem[] {
  const existing = q.find((i) => i.paneId === paneId && !DONE.includes(i.stage));
  if (existing) return q;
  return [...q.filter((i) => i.paneId !== paneId), { paneId, pr, stage: "queued", at }];
}

/** The one item being worked on: the first that isn't finished. */
export function active(q: QueueItem[]): QueueItem | undefined {
  return q.find((i) => !DONE.includes(i.stage));
}

const bounce = (i: QueueItem, reason: string): QueueItem => ({ ...i, stage: "bounced", reason });

export function advance(i: QueueItem, ev: QueueEvent): QueueItem {
  if (DONE.includes(i.stage)) return i;
  if (ev.type === "error") return bounce(i, ev.message);
  if (ev.type === "prMerged") return { ...i, stage: "merged" };
  switch (i.stage) {
    case "queued":
      return ev.type === "start" ? { ...i, stage: "syncing" } : i;
    case "syncing":
      if (ev.type === "synced") return { ...i, stage: "checks", sha: ev.sha };
      if (ev.type === "conflict") return bounce(i, "Rebasing on the base branch conflicts");
      return i;
    case "checks":
      if (ev.type !== "checks") return i;
      if (ev.checks === "fail") return bounce(i, `Checks failed${ev.failing?.length ? `: ${ev.failing.join(", ")}` : ""}`);
      if (ev.checks === "pass") return { ...i, stage: "verdict" };
      if (ev.checks === "none" && (ev.sinceSyncMs ?? Infinity) >= NONE_GRACE_MS) return { ...i, stage: "verdict" };
      if (ev.checks === "pending" && (ev.sinceSyncMs ?? 0) >= CHECKS_TIMEOUT_MS) return bounce(i, `Checks still running after ${CHECKS_TIMEOUT_MS / 60_000} minutes`);
      return i;
    case "verdict":
      if (ev.type !== "verdict") return i;
      if (ev.verdict === "PASS") return { ...i, stage: "merging" };
      return bounce(i, ev.verdict === "FAIL" ? "The reviewer said FAIL for this commit" : "No reviewer verdict for this commit: run verify-pr first");
    case "merging":
      return ev.type === "merged" ? { ...i, stage: "merged" } : i;
  }
  return i;
}

/** The latest `<!-- pr-verdict -->` comment's result for `sha` (posted by ~/.agents/tools/pr-verdict.sh), or null. */
export function verdictFor(comments: { body?: string }[], sha: string): "PASS" | "FAIL" | null {
  let found: "PASS" | "FAIL" | null = null;
  for (const c of comments) {
    const b = c.body ?? "";
    if (!b.trimStart().startsWith("<!-- pr-verdict -->")) continue;
    const m = /^Verdict: (PASS|FAIL) for ([0-9a-f]{7,40})\b/m.exec(b);
    if (m && (sha.startsWith(m[2]) || m[2].startsWith(sha))) found = m[1] as "PASS" | "FAIL";
  }
  return found;
}
