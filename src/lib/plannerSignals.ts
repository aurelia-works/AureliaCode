import type { PlannerState } from "./planner.ts";
import { localDate, planItems } from "./plannerToday.ts";

export type Severity = "info" | "warn" | "crit";

export interface Signal {
  /** Stable per rule and subject, so a snooze survives re-evaluation. */
  id: string;
  rule: "STALE_PROJECT" | "DEAD_WEIGHT" | "NOTHING_IN_PROGRESS" | "OVERDUE_CARD" | "PR_WAITING" | "LOW_SCORE";
  severity: Severity;
  projectId: string | null;
  title: string;
  reason: string;
  /** First message for "Start thread". */
  prompt: string;
}

export interface SignalInput {
  s: PlannerState;
  now: Date;
  /** Unix seconds of each project's newest commit; absent = unknown (the rule is skipped). */
  lastCommit: Record<string, number | null | undefined>;
  /** Open PRs that need you, mapped to a planner project when one matches. */
  prs: { projectId: string | null; number: number; url?: string; title: string; why: string }[];
}

export const STALE_DAYS = 7;
export const DEAD_DAYS = 14;
export const LOW_SCORE = 50;
export const EVENING_HOUR = 18;
const DAY = 86_400;

const live = (status: string) => status !== "Done" && status !== "Archived";

/** Project-health warnings from planner data, git activity and PRs. Pure: the same input gives the same list. */
export function evaluate({ s, now, lastCommit, prs }: SignalInput): Signal[] {
  const out: Signal[] = [];
  const today = localDate(now);
  const nowSec = now.getTime() / 1000;
  const sev = { crit: 2, warn: 1, info: 0 } as const;

  for (const p of s.projects) {
    if (p.archivedAt || !live(p.status)) continue;
    const last = lastCommit[p.id];
    if (last) {
      const days = Math.floor((nowSec - last) / DAY);
      if (days >= DEAD_DAYS)
        out.push({ id: `DEAD_WEIGHT:${p.id}`, rule: "DEAD_WEIGHT", severity: "crit", projectId: p.id, title: `${p.name} is dead weight`, reason: `No commits for ${days} days. Archive it or pick it back up.`, prompt: `${p.name} has had no commits for ${days} days. Look at where it stands and tell me whether to archive it or what the next step is.` });
      else if (days >= STALE_DAYS)
        out.push({ id: `STALE_PROJECT:${p.id}`, rule: "STALE_PROJECT", severity: "warn", projectId: p.id, title: `${p.name} looks stale`, reason: `No commits for ${days} days.`, prompt: `${p.name} has had no commits for ${days} days. Summarise where it stands and suggest the next small step.` });
    }
    const open = s.roadmapCards.filter((c) => c.project === p.id && c.lane !== "shipped");
    if (open.length && !open.some((c) => c.lane === "now"))
      out.push({ id: `NOTHING_IN_PROGRESS:${p.id}`, rule: "NOTHING_IN_PROGRESS", severity: "info", projectId: p.id, title: `Nothing in progress on ${p.name}`, reason: `${open.length} card${open.length === 1 ? "" : "s"} waiting, none in Now.`, prompt: `Nothing is in Now on the ${p.name} roadmap. Suggest which of these to start: ${open.map((c) => c.title).join("; ")}.` });
  }

  for (const c of s.roadmapCards) {
    if (c.lane === "shipped" || !c.dueDate || c.dueDate >= today) continue;
    out.push({ id: `OVERDUE_CARD:${c.id}`, rule: "OVERDUE_CARD", severity: "warn", projectId: c.project, title: `Overdue: ${c.title}`, reason: `Was due ${c.dueDate}.`, prompt: `${c.title}${c.description ? `\n\n${c.description}` : ""}` });
  }

  for (const pr of prs)
    out.push({ id: `PR_WAITING:${pr.url ?? pr.number}`, rule: "PR_WAITING", severity: "warn", projectId: pr.projectId, title: `PR #${pr.number} needs you`, reason: `${pr.title}: ${pr.why}.`, prompt: `PR #${pr.number} (${pr.title}) needs attention: ${pr.why}. Fix it.` });

  const day = s.dailyGoalsByDate[today];
  if (now.getHours() >= EVENING_HOUR && day && day.goals.length && day.score < LOW_SCORE)
    out.push({ id: `LOW_SCORE:${today}`, rule: "LOW_SCORE", severity: "warn", projectId: null, title: "Today's score is low", reason: `${day.score}% of today's points, and it's evening.`, prompt: `It's evening and I'm at ${day.score}% of today's goals. Open goals: ${day.goals.filter((g) => !g.done).map((g) => g.title).join("; ")}. Help me pick the one to finish.` });

  return out.sort((a, b) => sev[b.severity] - sev[a.severity] || a.id.localeCompare(b.id));
}

export const FOREVER = 8.64e15;
export const SNOOZES = [
  { label: "24 hours", ms: 86_400_000 },
  { label: "7 days", ms: 7 * 86_400_000 },
  { label: "Forever", ms: FOREVER },
] as const;

export const snooze = (s: PlannerState, id: string, ms: number, now = Date.now()): PlannerState => ({ ...s, snoozes: { ...s.snoozes, [id]: ms >= FOREVER ? FOREVER : now + ms } });
export const unsnoozeAll = (s: PlannerState): PlannerState => ({ ...s, snoozes: {} });

/** Signals not snoozed; an expired snooze counts as none. */
export const visible = (signals: Signal[], snoozes: Record<string, number>, now = Date.now()) => signals.filter((x) => !(snoozes[x.id] > now));

/** The daily briefing text: yesterday, today, and what needs you. Plain rules, no AI call. */
export function briefing(s: PlannerState, signals: Signal[], date: string, waiting: number, yesterday: string): string {
  const y = s.dailyGoalsByDate[yesterday];
  const t = s.dailyGoalsByDate[date];
  const lines: string[] = [];
  if (y?.goals.length) lines.push(`Yesterday: ${y.score}% of goals (${y.goals.filter((g) => g.done).length} of ${y.goals.length} done).`);
  const open = t?.goals.filter((g) => !g.done) ?? [];
  if (open.length) lines.push(`Today: ${open.length} goal${open.length === 1 ? "" : "s"} open, starting with "${open[0].title}".`);
  const plan = planItems(s, date).filter((i) => !i.done);
  if (plan.length) lines.push(`Plan: ${plan.length} item${plan.length === 1 ? "" : "s"} queued, next is "${plan[0].text}".`);
  if (waiting) lines.push(`${waiting} thread${waiting === 1 ? "" : "s"} waiting on you.`);
  const crit = signals.filter((x) => x.severity !== "info");
  if (crit.length) lines.push(`Signals: ${crit.slice(0, 3).map((x) => x.title).join("; ")}${crit.length > 3 ? ` and ${crit.length - 3} more` : ""}.`);
  if (!lines.length) lines.push("A quiet start: nothing waiting, nothing overdue.");
  return lines.join("\n");
}

/** Dismisses today's briefing (the card shows live text, so its text is only stored here, for history). */
export const dismissBriefing = (s: PlannerState, date: string, content = "", now = new Date().toISOString()): PlannerState => {
  const cur = s.dailyBriefings[date] ?? { date, content, generatedAt: now, dismissed: false };
  return { ...s, dailyBriefings: { ...s.dailyBriefings, [date]: { ...cur, dismissed: true } } };
};
