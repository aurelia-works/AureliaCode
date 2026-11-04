import { create } from "zustand";
import { goalAction, goalKickoff, judgeCheck, shouldCheck, type Goal } from "../lib/goalLoop";
import { ipc } from "../lib/ipc";
import type { TurnOutcome } from "../lib/workActions";
import { useLayout } from "./layout";
import { alertUser } from "./notifications";

/**
 * The impure half of a thread goal (lib/goalLoop.ts): run the check after a turn, record it on
 * the pane, and wake the agent, settle, or stop. `send` is the chat's sendChat, passed in so
 * this store doesn't import lib/chat (which calls it on every turn end).
 */

/** Per pane, the goal (by startedAt) whose check is running now. */
export const useGoalRuns = create<{ checking: Record<string, number> }>(() => ({ checking: {} }));

const setChecking = (paneId: string, startedAt: number | null) =>
  useGoalRuns.setState((s) => {
    const checking = { ...s.checking };
    if (startedAt !== null) checking[paneId] = startedAt;
    else if (checking[paneId] !== undefined) delete checking[paneId];
    return { checking };
  });

const patchGoal = (paneId: string, goal: Goal) => useLayout.getState().updatePane(paneId, { goal });

/** Starts a goal and sends the kickoff; returns why it can't start, or null. */
export function startGoal(paneId: string, goal: Omit<Goal, "startedAt" | "deadline" | "rounds"> & { hours: number }, send: (text: string) => void): string | null {
  if (!useLayout.getState().panes[paneId]?.cwd) return "This chat has no folder to run the check in";
  const { hours, ...rest } = goal;
  const now = Date.now();
  const g: Goal = { ...rest, startedAt: now, deadline: now + hours * 3600_000, rounds: 0 };
  patchGoal(paneId, g);
  send(goalKickoff(g));
  return null;
}

export function stopGoal(paneId: string) {
  const g = useLayout.getState().panes[paneId]?.goal;
  if (g && !g.ended) patchGoal(paneId, { ...g, ended: { at: Date.now(), why: "stopped" } });
}

export function clearGoal(paneId: string) {
  useLayout.getState().updatePane(paneId, { goal: undefined });
}

/**
 * Runs the check and acts on it. `auto` is a turn end: then an interrupted turn (you stepped
 * in) or a turn with more queued behind it doesn't trigger a round.
 */
export async function runGoalCheck(paneId: string, send: (text: string) => void, auto?: { outcome: TurnOutcome; queued: number }) {
  const pane = useLayout.getState().panes[paneId];
  const g = pane?.goal;
  if (!pane || !g || !shouldCheck(g, useGoalRuns.getState().checking[paneId], auto)) return;
  setChecking(paneId, g.startedAt);
  let code = -1;
  let output = "";
  let failed: string | null = pane.cwd ? null : "This chat has no folder to run the check in";
  try {
    if (!failed) {
      const r = await ipc.runCheck(pane.cwd!, g.check);
      code = r.code;
      output = r.output;
    }
  } catch (e) {
    failed = String(e);
  } finally {
    // A newer goal's check may have started meanwhile; only clear our own.
    if (useGoalRuns.getState().checking[paneId] === g.startedAt) setChecking(paneId, null);
  }
  // Stopped, cleared or replaced while the check ran: this result belongs to nobody.
  const now = useLayout.getState().panes[paneId]?.goal;
  if (!now || now.ended || now.startedAt !== g.startedAt) return;
  // The check couldn't run at all (folder gone, no zsh): waking the agent wouldn't help.
  if (failed) {
    patchGoal(paneId, { ...now, ended: { at: Date.now(), why: "error", detail: failed } });
    alertUser({ kind: "error", paneId, title: "Goal stopped: the check couldn't run", body: failed });
    return;
  }
  const check = judgeCheck(now, code, output);
  const at = Date.now();
  const action = goalAction(now, check, at);
  const last = { ...check, at };
  if (action.kind === "met") {
    patchGoal(paneId, { ...now, last, ended: { at, why: "met" } });
    alertUser({ kind: "finished", paneId, title: "Goal met", body: now.text });
  } else if (action.kind === "stop") {
    patchGoal(paneId, { ...now, last, ended: { at, why: action.why } });
    alertUser({ kind: "info", paneId, title: "Goal stopped", body: action.why === "rounds" ? `${now.maxRounds} rounds and the check still fails. Over to you.` : "Out of time and the check still fails. Over to you." });
  } else {
    patchGoal(paneId, { ...now, last, rounds: now.rounds + 1 });
    send(action.text);
  }
}
