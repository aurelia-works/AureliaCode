/**
 * A thread's goal: after each finished turn, run the goal's check in the thread's folder and,
 * until it passes, wake the agent with the output. A check can print `SCORE: n/10` (a test
 * suite, a lint count turned into a score, a judge script scoring screenshots), and the goal
 * can ask for a score as well as exit 0. Bounded by rounds and time, like PR babysitting.
 * Rules only, so it runs under `node --test`.
 */

export interface GoalCheck {
  met: boolean;
  code: number;
  score?: number;
  /** The end of the check's output, as sent back to the agent. */
  tail: string;
}

export interface Goal {
  text: string;
  /** Shell command run in the thread's folder; exit 0 is a pass. */
  check: string;
  /** Out of 10: the check must also print a score at least this high. */
  target?: number;
  /** Attempts in all, the first turn included. */
  maxRounds: number;
  startedAt: number;
  /** When the loop gives up (ms since epoch). */
  deadline: number;
  /** Failed checks that woke the agent so far; the attempt under way is `rounds + 1`. */
  rounds: number;
  last?: GoalCheck & { at: number };
  /** Set once the goal is met or the loop stopped; the banner then shows the outcome. */
  ended?: { at: number; why: "met" | "rounds" | "time" | "stopped" | "error"; detail?: string };
}

export const DEFAULT_ROUNDS = 8;
export const DEFAULT_HOURS = 4;
const TAIL_CHARS = 3000;

/** The last `SCORE: n/10` the check printed (0-10), if any. */
export function parseScore(output: string): number | undefined {
  let score: number | undefined;
  for (const m of output.matchAll(/score\s*:?\s*(\d+(?:\.\d+)?)\s*\/\s*10\b/gi)) {
    const n = Number(m[1]);
    if (n >= 0 && n <= 10) score = n;
  }
  return score;
}

export function judgeCheck(goal: Pick<Goal, "target">, code: number, output: string): GoalCheck {
  const score = parseScore(output);
  const met = code === 0 && (goal.target === undefined || (score !== undefined && score >= goal.target));
  const trimmed = output.trimEnd();
  const tail = trimmed.length > TAIL_CHARS ? trimmed.slice(-TAIL_CHARS) : trimmed;
  return { met, code, ...(score !== undefined && { score }), tail };
}

export type GoalAction = { kind: "met" } | { kind: "stop"; why: "rounds" | "time" } | { kind: "wake"; text: string };

function verdictLine(goal: Pick<Goal, "target">, c: GoalCheck): string {
  const parts = [c.code === 0 ? "exited 0" : `exited ${c.code}`];
  if (goal.target !== undefined) parts.push(c.score === undefined ? `printed no SCORE line (needs ${goal.target}/10)` : `scored ${c.score}/10, needs ${goal.target}`);
  return parts.join(", ");
}

/** What to do after a check: done, give up, or send the agent the next round. */
export function goalAction(goal: Goal, c: GoalCheck, now: number): GoalAction {
  if (c.met) return { kind: "met" };
  if (goal.rounds + 1 >= goal.maxRounds) return { kind: "stop", why: "rounds" };
  if (now >= goal.deadline) return { kind: "stop", why: "time" };
  const round = goalRound(goal);
  return {
    kind: "wake",
    text: [
      `Goal not met yet after round ${round} of ${goal.maxRounds}: \`${goal.check}\` ${verdictLine(goal, c)}.`,
      `Goal: ${goal.text}`,
      "End of its output:",
      "```",
      c.tail || "(no output)",
      "```",
      "Fix the cause, not the check. Keep going; I run the check again when you finish this turn.",
    ].join("\n"),
  };
}

/** The attempt to show: the one under way, or the last one once the goal ended. */
export function goalRound(goal: Pick<Goal, "rounds" | "maxRounds">): number {
  return Math.min(goal.rounds + 1, goal.maxRounds);
}

/**
 * Whether to run the check now. `checkingFor` is the goal (by startedAt) whose check is
 * running in this pane, if any: a check left over from a stopped goal doesn't block a new one.
 * `auto` is a turn end; an interrupted turn (you stepped in) or one with more queued doesn't count.
 */
export function shouldCheck(goal: Pick<Goal, "startedAt" | "ended">, checkingFor: number | undefined, auto?: { outcome: string; queued: number }): boolean {
  if (goal.ended || checkingFor === goal.startedAt) return false;
  return !auto || (auto.outcome !== "interrupted" && auto.queued === 0);
}

export function goalKickoff(goal: Goal): string {
  const budget = elapsedLabel(goal.deadline - goal.startedAt);
  const done = goal.target === undefined ? `\`${goal.check}\` exits 0` : `\`${goal.check}\` exits 0 and prints a last SCORE: n/10 of at least ${goal.target}`;
  return [
    `Goal: ${goal.text}`,
    `Done when ${done}. After each of your turns I run it in this folder and send you its output until it passes, for up to ${goal.maxRounds} rounds (this one included) or ${budget}.`,
    "Work towards it now. Don't edit the check to make it pass.",
  ].join("\n");
}

/** "45s", "14m", "3h 48m". */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}
