/**
 * When a thread is ready for you (Theo Browne, 2026-11-04: "the agent shouldn't bother you
 * until the code is ready to merge"): it has finished and shows proof, either a goal check
 * that passed or a council review at or above the bar on the diff as it is now. Also the
 * tripwire for a diff that keeps growing, and the brief a scrapped thread starts over with.
 * No imports, so it runs under `node --test`.
 */

export interface Stat {
  files: number;
  additions: number;
  deletions: number;
}

export interface ReviewMark {
  score?: number;
  verdict?: "ship" | "fix" | "block";
  /** Verified findings tagged important. */
  important: number;
  /** The folder's diff when the review ran. */
  stat?: Stat | null;
}

export interface ProofInput {
  /** Council score a review needs to count as proof. */
  bar: number;
  goal?: { check: string; last?: { met: boolean; code: number }; ended?: { why: string } };
  review?: ReviewMark;
  stat?: Stat | null;
}

export interface Proof {
  ok: boolean;
  text: string;
}

export const sameStat = (a?: Stat | null, b?: Stat | null) =>
  (a?.files ?? 0) === (b?.files ?? 0) && (a?.additions ?? 0) === (b?.additions ?? 0) && (a?.deletions ?? 0) === (b?.deletions ?? 0);

export function proofOf({ bar, goal, review, stat }: ProofInput): Proof {
  if (goal?.ended?.why === "met") return { ok: true, text: `Check passed: ${goal.check}` };
  if (review) {
    if (!sameStat(review.stat, stat)) return { ok: false, text: "The diff changed since the council review" };
    const score = review.score === undefined ? "no score" : `${review.score}/10`;
    if (review.important > 0) return { ok: false, text: `Council ${score}, ${review.important} verified important finding${review.important === 1 ? "" : "s"}` };
    if (review.score !== undefined && review.score >= bar && review.verdict !== "block") return { ok: true, text: `Council ${score}, no verified important findings` };
    return { ok: false, text: `Council ${score}, under the bar of ${bar}` };
  }
  if (goal?.last && !goal.last.met) return { ok: false, text: `Check failing: ${goal.check} exited ${goal.last.code}` };
  return { ok: false, text: "No proof yet: run the council review or give it a goal check" };
}

export function isReady(v: string, proof: Proof): boolean {
  return (v === "done" || v === "idle") && proof.ok;
}

const total = (s: Stat) => s.additions + s.deletions;
const MIN_BASE = 20;
const MIN_GROWTH = 200;

/** The diff more than doubled since the thread's first one: is it running in circles? */
export function diffGrowth(base: Stat | null | undefined, now: Stat | null | undefined): { from: number; to: number; factor: number } | null {
  if (!base || !now || total(base) < MIN_BASE) return null;
  const from = total(base);
  const to = total(now);
  if (to < from * 2 || to - from < MIN_GROWTH) return null;
  return { from, to, factor: Math.round((to / from) * 10) / 10 };
}

/** The first message of a thread started over from a scrapped one. */
export function scrapSeed(brief: string): string {
  return [
    "Start this task again from scratch. The last attempt was scrapped, so delete or rewrite anything it left behind; you don't need to keep any of it.",
    "",
    "Task:",
    brief.trim(),
  ].join("\n");
}
