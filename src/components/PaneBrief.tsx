import { useEffect, useMemo, useState } from "react";
import { recentSteps } from "../lib/recentSteps";
import { useAgents } from "../store/agents";
import { goalRound } from "../lib/goalLoop";
import { sendChat } from "../lib/chat";
import { runGoalCheck, stopGoal } from "../store/goals";
import { useLayout } from "../store/layout";
import { useUi } from "../store/ui";
import { diffGrowth, proofOf } from "../lib/proof";
import { useGit } from "../store/git";
import { markOf, noteBase, useReviews } from "../store/reviews";
import type { Visual } from "./StatusGlyph";
import { ThreadCardHead, ThreadMeta, useThreadSummary } from "./ThreadCard";

/** The one next step a card offers; it opens the thread so you can do it there. */
const ACTION: Partial<Record<Visual, string>> = {
  needs_input: "Answer",
  done: "Read the result",
  idle: "Start this thread",
};

/**
 * A grid pane with no conversation on screen: one compact card that says what the thread is,
 * its state, what it is waiting on and when that last changed, so six panes read at a glance
 * instead of asking six times what to do. The single, full-size pane keeps the big empty state.
 */
export function PaneBrief({ paneId, cwd }: { paneId: string; cwd?: string }) {
  const t = useThreadSummary(paneId, cwd);
  const goal = useLayout((s) => s.panes[paneId]?.goal);
  const feedOn = useUi((s) => s.prefs.briefFeed);
  const recent = useAgents((s) => s.sessions[paneId]?.recent);
  const steps = useMemo(() => recentSteps(recent ?? [], 4), [recent]);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const v = t.v;
  const prefs = useUi((s) => s.prefs);
  const dir = useLayout((s) => s.panes[paneId]?.cwd) ?? cwd;
  const root = useGit((s) => (dir ? s.info[dir]?.root : undefined));
  const stat = useGit((s) => (dir ? s.stat[dir] : undefined));
  const review = useReviews((s) => (root ? s.byRoot[root] : undefined));
  const base = useReviews((s) => s.base[paneId]);
  const proof = (v === "done" || (v === "idle" && (goal || review))) ? proofOf({ bar: prefs.readyScore, goal, review: markOf(review), stat }) : null;
  const grown = diffGrowth(base, stat);

  return (
    <div className={`pane-brief ${v}`} role="status">
      <ThreadCardHead t={t} />
      <p className="pane-brief-detail">{t.detail}</p>
      {feedOn && steps.length > 0 && (
        <ol className="pane-brief-feed" aria-label="Recent steps">
          {steps.map((s) => (
            <li key={s.id} className={s.failed ? "failed" : undefined} title={s.detail}>
              {s.text}
            </li>
          ))}
        </ol>
      )}
      {grown && (
        <div className="pane-brief-trip" role="alert">
          <span>
            The diff grew {grown.factor}× since this thread started ({grown.from} → {grown.to} lines). Running in circles?
          </span>
          <button type="button" className="btn sm" onClick={() => noteBase(paneId, stat, true)}>
            Keep going
          </button>
        </div>
      )}
      {proof && <p className={`pane-brief-proof${proof.ok ? " ok" : ""}`}>{proof.ok ? `Proof: ${proof.text}` : proof.text}</p>}
      {goal && !goal.ended && (
        <div className="pane-brief-goal">
          <span className="pane-brief-goal-text" title={goal.text}>
            Goal: {goal.text}
          </span>
          <span className="chat-goal-bar" role="progressbar" aria-label="Goal rounds used" aria-valuemin={0} aria-valuemax={goal.maxRounds} aria-valuenow={goalRound(goal)}>
            <i style={{ width: `${Math.min(100, (goalRound(goal) / goal.maxRounds) * 100)}%` }} />
          </span>
          <span className="num">
            Round {goalRound(goal)} of {goal.maxRounds}
            {goal.last && !goal.last.met ? ` · last check failed (exit ${goal.last.code})` : ""}
            {v === "working" ? " · next check runs when this turn ends" : ""}
          </span>
          <span className="pane-brief-goal-acts">
            <button type="button" className="btn sm" disabled={v === "working"} title={v === "working" ? "The check runs when this turn ends" : `Run \`${goal.check}\` now`} onClick={() => void runGoalCheck(paneId, (t) => void sendChat(paneId, t))}>
              Check now
            </button>
            <button type="button" className="btn sm" onClick={() => stopGoal(paneId)}>
              Stop goal
            </button>
          </span>
        </div>
      )}
      {ACTION[v] && (
        <button type="button" className={`btn${v === "needs_input" ? " primary" : ""} pane-brief-act`} onClick={() => {
            useLayout.getState().focusPane(paneId);
            // Starting means typing the first message: put the cursor there.
            if (v === "idle") requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`[data-chat-input="${paneId}"]`)?.focus());
          }}>
          {ACTION[v]}
        </button>
      )}
      <ThreadMeta t={t} />
    </div>
  );
}
