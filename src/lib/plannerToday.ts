import type { DailyGoals, Goal, PlanItem, PlannerState, TodayPlan } from "./planner.ts";

/** Local calendar date, so goals roll over at local midnight (Linkra used UTC). */
export function localDate(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

let seq = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const emptyDay = (date: string): DailyGoals => ({ date, goals: [], score: 0, completedPoints: 0, totalPoints: 0, isClosed: false, archivedAt: null });

/** Totals and score (percent of points done) from the goals themselves. */
export function tally(day: DailyGoals): DailyGoals {
  const total = day.goals.reduce((n, g) => n + g.points, 0);
  const done = day.goals.reduce((n, g) => n + (g.done ? g.points : 0), 0);
  return { ...day, totalPoints: total, completedPoints: done, score: total ? Math.round((done / total) * 100) : 0 };
}

/** Today's day: kept if it exists, otherwise a fresh copy of the goal template. */
export function ensureDay(s: PlannerState, date: string, now = new Date().toISOString()): PlannerState {
  if (s.dailyGoalsByDate[date]) return s;
  const goals = s.goalTemplate.map((g, i): Goal => ({ ...g, id: `${date}-t${i}`, done: false, createdAt: now, completedAt: null }));
  return { ...s, dailyGoalsByDate: { ...s.dailyGoalsByDate, [date]: tally({ ...emptyDay(date), goals }) } };
}

const withDay = (s: PlannerState, date: string, fn: (d: DailyGoals) => DailyGoals): PlannerState => {
  const base = ensureDay(s, date);
  const day = base.dailyGoalsByDate[date];
  return { ...base, dailyGoalsByDate: { ...base.dailyGoalsByDate, [date]: tally(fn(day)) } };
};

export const toggleGoal = (s: PlannerState, date: string, id: string, now = new Date().toISOString()) =>
  withDay(s, date, (d) => ({ ...d, goals: d.goals.map((g) => (g.id === id ? { ...g, done: !g.done, completedAt: g.done ? null : now } : g)) }));

export const addGoal = (s: PlannerState, date: string, title: string, opts: { points?: number; category?: string; projectId?: string | null } = {}, now = new Date().toISOString()) => {
  const text = title.trim();
  if (!text) return s;
  const g: Goal = { id: newId("g"), title: text, category: opts.category ?? "General", points: opts.points ?? 3, done: false, createdAt: now, completedAt: null, projectId: opts.projectId ?? null };
  return withDay(s, date, (d) => ({ ...d, goals: [...d.goals, g] }));
};

export const removeGoal = (s: PlannerState, date: string, id: string) => withDay(s, date, (d) => ({ ...d, goals: d.goals.filter((g) => g.id !== id) }));

/** Moves an item one step up (-1) or down (+1); out-of-range moves change nothing. */
export function moveIn<T extends { id: string }>(list: T[], id: string, by: -1 | 1): T[] {
  const i = list.findIndex((x) => x.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
export const moveGoal = (s: PlannerState, date: string, id: string, by: -1 | 1) => withDay(s, date, (d) => ({ ...d, goals: moveIn(d.goals, id, by) }));

export const planItems = (s: PlannerState, date: string): PlanItem[] => s.todayPlanByDate[date]?.items ?? [];

function withPlan(s: PlannerState, date: string, fn: (items: PlanItem[]) => PlanItem[], source: TodayPlan["source"], now: string): PlannerState {
  const cur = s.todayPlanByDate[date];
  const plan: TodayPlan = { taskIds: cur?.taskIds ?? [], notes: cur?.notes ?? null, generatedAt: now, source, items: fn(cur?.items ?? []) };
  return { ...s, todayPlanByDate: { ...s.todayPlanByDate, [date]: plan } };
}
export const addPlanItem = (s: PlannerState, date: string, text: string, now = new Date().toISOString()) =>
  text.trim() ? withPlan(s, date, (l) => [...l, { id: newId("p"), text: text.trim(), done: false }], "manual", now) : s;
export const togglePlanItem = (s: PlannerState, date: string, id: string) =>
  withPlan(s, date, (l) => l.map((x) => (x.id === id ? { ...x, done: !x.done } : x)), s.todayPlanByDate[date]?.source ?? "manual", s.todayPlanByDate[date]?.generatedAt ?? "");
export const removePlanItem = (s: PlannerState, date: string, id: string) =>
  withPlan(s, date, (l) => l.filter((x) => x.id !== id), s.todayPlanByDate[date]?.source ?? "manual", s.todayPlanByDate[date]?.generatedAt ?? "");
export const movePlanItem = (s: PlannerState, date: string, id: string, by: -1 | 1) =>
  withPlan(s, date, (l) => moveIn(l, id, by), s.todayPlanByDate[date]?.source ?? "manual", s.todayPlanByDate[date]?.generatedAt ?? "");

/** Plan lines from a pasted reply: one item per line, list markers and checkboxes stripped. */
export function parsePlanText(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*(?:\[[ xX]\]\s*)?/, "").trim())
    .filter((l) => l && !/^#+\s/.test(l));
}
/** Replaces the day's plan with the parsed lines (source "auto": it came from a thread). */
export const writePlan = (s: PlannerState, date: string, text: string, now = new Date().toISOString()) =>
  withPlan(s, date, () => parsePlanText(text).map((t) => ({ id: newId("p"), text: t, done: false })), "auto", now);

/** The one prompt "Plan my day" sends: today's goals, open project tasks, yesterday's leftovers. */
export function planPrompt(s: PlannerState, date: string, events: string[] = []): string {
  const day = s.dailyGoalsByDate[date];
  const open = (day?.goals ?? []).filter((g) => !g.done).map((g) => `- ${g.title} (${g.points} pts)`);
  const tasks = s.projects.filter((p) => !p.archivedAt).flatMap((p) => p.tasks.filter((t) => !t.done).slice(0, 5).map((t) => `- [${p.name}] ${t.text}`));
  const lines = [`Plan my day for ${date}. Reply with a short numbered list of the 3 to 7 things to do, in order, one per line, nothing else.`];
  if (open.length) lines.push("", "Today's goals:", ...open);
  if (tasks.length) lines.push("", "Open project tasks:", ...tasks);
  if (events.length) lines.push("", "Calendar:", ...events.map((e) => `- ${e}`));
  return lines.join("\n");
}

export type CaptureTarget = "today" | { projectId: string };
/** Quick capture: a goal for today, or a task on a project. */
export function capture(s: PlannerState, target: CaptureTarget, text: string, date: string, now = new Date().toISOString()): PlannerState {
  const t = text.trim();
  if (!t) return s;
  if (target === "today") return addGoal(s, date, t, {}, now);
  return {
    ...s,
    projects: s.projects.map((p) =>
      p.id === target.projectId
        ? { ...p, updatedAt: now, tasks: [...p.tasks, { id: newId("k"), text: t, done: false, status: "todo", dependsOnIds: [], priority: "med", dueDate: null, milestone: null, createdAt: now, completedAt: null }] }
        : p,
    ),
  };
}

/** True when `dir` is `root` or inside it, comparing whole path segments ("~/dev/app-two" is not inside "~/dev/app"). */
export function isWithin(dir: string, root: string): boolean {
  const r = root.replace(/\/+$/, "");
  return dir === r || dir.startsWith(`${r}/`);
}

/** The planner project whose folder holds `dir`; the deepest match wins. */
export function projectForDir<P extends { localRepoPath: string | null }>(projects: P[], dir: string | undefined, expand: (p: string) => string): P | undefined {
  if (!dir) return undefined;
  let best: P | undefined;
  for (const p of projects) {
    if (!p.localRepoPath) continue;
    const root = expand(p.localRepoPath);
    if (isWithin(dir, root) && (!best || root.length > expand(best.localRepoPath!).length)) best = p;
  }
  return best;
}
