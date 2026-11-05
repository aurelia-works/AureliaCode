import { create } from "zustand";
import { nextRound, type Council } from "../lib/council";
import type { DiffStat } from "../lib/ipc";
import type { ReviewMark } from "../lib/proof";

export interface RepoReview {
  council: Council;
  /** Each reviewer's model and seconds, in seat order. */
  seats: { model: string; seconds: number; failed: boolean; score?: number }[];
  at: number;
  /** The repo's diff when it ran, so a later change voids it as proof. */
  stat: DiffStat | null;
  /** The branch it ran on: rounds carry on only for the same branch. */
  branch?: string;
  /** Council rounds run on this branch (Reset on the review page starts over). */
  rounds: number;
}

interface ReviewsState {
  /** By repo root (GitInfo.root). In memory: a restart starts the rounds over. */
  byRoot: Record<string, RepoReview>;
  /** The first diff seen per working thread, for the tripwire (lib/proof.ts diffGrowth). */
  base: Record<string, DiffStat>;
}

export const useReviews = create<ReviewsState>(() => ({ byRoot: {}, base: {} }));

export function saveCouncil(root: string, r: Omit<RepoReview, "rounds">) {
  useReviews.setState((s) => ({ byRoot: { ...s.byRoot, [root]: { ...r, rounds: nextRound(s.byRoot[root], r.branch) } } }));
}

/** Forget a repo's council, so the next one is round 1. */
export function resetCouncil(root: string) {
  useReviews.setState((s) => {
    const byRoot = { ...s.byRoot };
    delete byRoot[root];
    return { byRoot };
  });
}

export function markOf(r: RepoReview | undefined): ReviewMark | undefined {
  if (!r) return undefined;
  return { score: r.council.score, verdict: r.council.verdict, important: r.council.findings.filter((f) => f.verified && f.tag === "important").length, stat: r.stat };
}

/** Remember a working thread's first diff; "Keep going" moves the baseline to now. */
export function noteBase(paneId: string, stat: DiffStat | null | undefined, reset = false) {
  if (!stat || !stat.files) return;
  const have = useReviews.getState().base[paneId];
  if (have && !reset) return;
  useReviews.setState((s) => ({ base: { ...s.base, [paneId]: stat } }));
}
