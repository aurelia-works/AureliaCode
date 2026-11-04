import { useEffect, useState } from "react";
import { sendChat } from "../lib/chat";
import { DEFAULT_HOURS, DEFAULT_ROUNDS, elapsedLabel, goalRound, type Goal } from "../lib/goalLoop";
import { clearGoal, runGoalCheck, startGoal, stopGoal, useGoalRuns } from "../store/goals";
import { useLayout } from "../store/layout";

const ENDED: Record<NonNullable<Goal["ended"]>["why"], string> = {
  met: "Goal met",
  rounds: "Goal stopped: out of rounds",
  time: "Goal stopped: out of time",
  stopped: "Goal stopped",
  error: "Goal stopped: the check couldn't run",
};

function lastLine(g: Goal): string | null {
  const c = g.last;
  if (!c) return null;
  if (c.met) return `Last check: passed${c.score !== undefined ? `, ${c.score}/10` : ""}`;
  const parts = [`exit ${c.code}`];
  if (g.target !== undefined) parts.push(c.score === undefined ? `no score (needs ${g.target})` : `${c.score}/10 (needs ${g.target})`);
  return `Last check: ${parts.join(", ")}`;
}

/** Above the composer while a chat has a goal: what it is, the round, the time, the last check. */
export function GoalBanner({ paneId }: { paneId: string }) {
  const goal = useLayout((s) => s.panes[paneId]?.goal);
  const checkingFor = useGoalRuns((s) => s.checking[paneId]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!goal || goal.ended) return;
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [goal]);
  if (!goal) return null;
  const checking = !goal.ended && checkingFor === goal.startedAt;
  const send = (t: string) => void sendChat(paneId, t);
  const end = goal.ended;
  const took = elapsedLabel((end?.at ?? Date.now()) - goal.startedAt);
  const last = goal.ended?.why === "error" ? (goal.ended.detail ?? null) : lastLine(goal);
  return (
    <div className={`chat-goal${end ? ` ended ${end.why}` : ""}`} role="status">
      <span className="chat-goal-mark" aria-hidden>
        ◎
      </span>
      <div className="chat-goal-main">
        <div className="chat-goal-top">
          <span className="chat-goal-label">{end ? ENDED[end.why] : "Goal"}</span>
          <span className="chat-goal-text" title={goal.text}>
            {goal.text}
          </span>
        </div>
        <div className="chat-goal-meta num">
          <span title={`Each round runs \`${goal.check}\` after a turn`}>
            Round {goalRound(goal)} of {goal.maxRounds}
          </span>
          <span>{took}</span>
          {checking ? <span className="chat-goal-checking">Checking…</span> : last && <span title={goal.last?.tail.slice(-400)}>{last}</span>}
        </div>
      </div>
      <div className="chat-goal-actions">
        {end ? (
          <button type="button" onClick={() => clearGoal(paneId)}>
            Dismiss
          </button>
        ) : (
          <>
            <button type="button" disabled={checking} onClick={() => void runGoalCheck(paneId, send)} title={`Run \`${goal.check}\` now`}>
              Check now
            </button>
            <button type="button" onClick={() => stopGoal(paneId)}>
              Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Sets a chat's goal: what done means, the check that proves it, and the budget. */
export function GoalDialog({ paneId, onClose }: { paneId: string; onClose: () => void }) {
  const prev = useLayout((s) => s.panes[paneId]?.goal);
  const [text, setText] = useState(prev?.text ?? "");
  const [check, setCheck] = useState(prev?.check ?? "");
  const [target, setTarget] = useState(prev?.target !== undefined ? String(prev.target) : "");
  const [rounds, setRounds] = useState(String(prev?.maxRounds ?? DEFAULT_ROUNDS));
  const [hours, setHours] = useState(String(DEFAULT_HOURS));
  const score = target.trim() === "" ? undefined : Number(target);
  const bad =
    !text.trim() ? "Say what the goal is" : !check.trim() ? "Give the command that proves it" : score !== undefined && !(score > 0 && score <= 10) ? "A score target is 1 to 10" : !(Number(rounds) >= 1) ? "At least 1 round" : !(Number(hours) > 0) ? "Give it some time" : null;
  const [refused, setRefused] = useState<string | null>(null);
  const start = () => {
    if (bad) return;
    const why = startGoal(paneId, { text: text.trim(), check: check.trim(), ...(score !== undefined && { target: score }), maxRounds: Math.round(Number(rounds)), hours: Number(hours) }, (t) => void sendChat(paneId, t));
    if (why) setRefused(why);
    else onClose();
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal goal-dialog"
        role="dialog"
        aria-label="Set a goal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <div className="modal-head">
          <h2>Set a goal</h2>
        </div>
        <div className="goal-dialog-body">
          <p className="hint">Claude keeps working until the check passes. After each turn the check runs in this folder and Claude gets its output.</p>
          <label className="field">
            <span>Goal</span>
            <textarea rows={3} autoFocus value={text} placeholder="e.g. The settings page passes the accessibility audit" onChange={(e) => setText(e.target.value)} />
          </label>
          <label className="field">
            <span>Done when this passes</span>
            <input value={check} spellCheck={false} placeholder="npm test" onChange={(e) => setCheck(e.target.value)} />
          </label>
          <div className="goal-dialog-row">
            <label className="field">
              <span>Score at least (of 10)</span>
              <input inputMode="decimal" value={target} placeholder="optional" onChange={(e) => setTarget(e.target.value)} />
            </label>
            <label className="field">
              <span>Rounds</span>
              <input inputMode="numeric" value={rounds} onChange={(e) => setRounds(e.target.value)} />
            </label>
            <label className="field">
              <span>Hours</span>
              <input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
            </label>
          </div>
          <p className="hint">
            With a score, the check must also print a line like <code>SCORE: 8.5/10</code>; the last one counts. Rounds count every attempt, the first included. No new round starts once the time is up; a turn already running isn't stopped.
          </p>
        </div>
        <div className="modal-foot actions">
          <span className="msg">{refused ?? bad ?? (prev && !prev.ended ? "replaces the current goal" : "sends Claude the goal now")}</span>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!!bad}>
            Start
          </button>
        </div>
      </form>
    </div>
  );
}
