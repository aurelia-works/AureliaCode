/** Planner data folded in from Linkra (schema v3). Plain types plus a hand validator; no zod. */

export interface Goal {
  id: string;
  title: string;
  category: string;
  points: number;
  done: boolean;
  createdAt: string;
  completedAt: string | null;
  /** Planner project the goal belongs to; "Start thread" opens in its folder. */
  projectId?: string | null;
}
export interface DailyGoals {
  date: string;
  goals: Goal[];
  score: number;
  completedPoints: number;
  totalPoints: number;
  isClosed: boolean;
  archivedAt: string | null;
}
export type RoadmapLane = "now" | "next" | "later" | "shipped";
export interface RoadmapCard {
  id: string;
  lane: RoadmapLane;
  title: string;
  description: string;
  tags: string[];
  linkedRepo: string | null;
  linkedMilestone: string | null;
  dueDate: string | null;
  project: string | null;
  /** A goal (by id, any day) that ticks when the card ships. */
  goalId?: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ProjectTask {
  id: string;
  text: string;
  done: boolean;
  status: "todo" | "doing" | "done";
  dependsOnIds: string[];
  priority: "low" | "med" | "high";
  dueDate: string | null;
  milestone: string | null;
  createdAt: string;
  completedAt: string | null;
}
export interface PlannerProject {
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  color: string;
  status: string;
  progress: number;
  githubRepo: string | null;
  localRepoPath: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tasks: ProjectTask[];
}
export interface Habit {
  id: string;
  title: string;
  frequency: "daily" | "weekdays" | "custom";
  customDays: number[];
  color: string;
  icon: string;
  linkedProjectId: string | null;
  targetStreak: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}
export interface HabitCompletion {
  id: string;
  habitId: string;
  date: string;
  createdAt: string;
}
export interface FocusSession {
  id: string;
  startedAt: string;
  durationMinutes: number;
  completedAt: string | null;
  planned: boolean;
  projectId: string | null;
  reason: string | null;
}
export interface SessionLog {
  id: string;
  ts: string;
  text: string;
  project: string | null;
  tags: string[];
}
export interface QuickCapture {
  id: string;
  type: "note" | "task" | "roadmap" | "journal";
  text: string;
  createdAt: string;
}
export interface JournalEntry {
  id: string;
  projectId: string | null;
  ts: string;
  type: "note" | "decision" | "blocker" | "next" | "idea";
  title: string | null;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
export interface PlanItem {
  id: string;
  text: string;
  done: boolean;
}
export interface TodayPlan {
  taskIds: string[];
  /** The day's queue: typed in, or written back from a "Plan my day" thread. */
  items?: PlanItem[];
  generatedAt: string;
  source: "manual" | "auto";
  notes: string | null;
}
export interface DailyBriefing {
  date: string;
  content: string;
  generatedAt: string;
  dismissed: boolean;
}
/** Insights, reviews and snapshots keep their Linkra shape; later phases read the fields they need. */
export interface Loose {
  id: string;
  [k: string]: unknown;
}

/** Dev-panel switches (Settings → Planner). Each visible planner piece gets one as it is built. */
export interface PlannerSwitches {
  today: boolean;
  roadmap: boolean;
  habits: boolean;
  focus: boolean;
  signals: boolean;
  review: boolean;
  calendar: boolean;
}

/** Things that happened in AureliaSpace, kept so the weekly review can count them. */
export interface ActivityEvent {
  id: string;
  ts: string;
  kind: "thread-settled" | "pr-merged" | "card-shipped";
  label: string;
}

export interface PlannerSettings {
  /** Pomodoro lengths in minutes (Settings → Planner). */
  focusMinutes: number;
  breakMinutes: number;
}

export interface PlannerState {
  version: 1;
  settings: PlannerSettings;
  importedAt: string | null;
  switches: PlannerSwitches;
  /** Signal id → epoch ms it is hidden until (Settings-free; set from the Board). */
  snoozes: Record<string, number>;
  activity: ActivityEvent[];
  /** Free-form notes per project id ("" key = no project). */
  scratchpads: Record<string, string>;
  projects: PlannerProject[];
  dailyGoalsByDate: Record<string, DailyGoals>;
  goalTemplate: Goal[];
  todayPlanByDate: Record<string, TodayPlan>;
  roadmapCards: RoadmapCard[];
  habits: Habit[];
  habitCompletions: HabitCompletion[];
  focusSessions: FocusSession[];
  sessionLogs: SessionLog[];
  quickCaptures: QuickCapture[];
  journalEntries: JournalEntry[];
  insights: Loose[];
  weeklyReviews: Loose[];
  weeklySnapshots: Loose[];
  dailyBriefings: Record<string, DailyBriefing>;
}

export const emptyPlanner = (): PlannerState => ({
  version: 1,
  importedAt: null,
  settings: { focusMinutes: 25, breakMinutes: 5 },
  snoozes: {},
  activity: [],
  scratchpads: {},
  switches: { today: true, roadmap: true, habits: true, focus: true, signals: true, review: true, calendar: true },
  projects: [],
  dailyGoalsByDate: {},
  goalTemplate: [],
  todayPlanByDate: {},
  roadmapCards: [],
  habits: [],
  habitCompletions: [],
  focusSessions: [],
  sessionLogs: [],
  quickCaptures: [],
  journalEntries: [],
  insights: [],
  weeklyReviews: [],
  weeklySnapshots: [],
  dailyBriefings: {},
});

/** Saved state from an older or hand-edited file: fill anything missing so readers can trust the shape. */
export function normalizePlanner(raw: unknown): PlannerState {
  const base = emptyPlanner();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<PlannerState>;
  const out = { ...base, ...r, version: 1 as const };
  out.switches = { ...base.switches, ...(r.switches ?? {}) };
  out.settings = { ...base.settings, ...(r.settings ?? {}) };
  for (const k of Object.keys(base) as (keyof PlannerState)[]) {
    if (Array.isArray(base[k]) !== Array.isArray(out[k])) (out as Record<string, unknown>)[k] = base[k];
  }
  return out;
}

export const PLANNER_KINDS: [keyof PlannerState, string][] = [
  ["projects", "Projects"],
  ["dailyGoalsByDate", "Days of goals"],
  ["goalTemplate", "Template goals"],
  ["todayPlanByDate", "Day plans"],
  ["roadmapCards", "Roadmap cards"],
  ["habits", "Habits"],
  ["habitCompletions", "Habit check-ins"],
  ["focusSessions", "Focus sessions"],
  ["sessionLogs", "Session logs"],
  ["quickCaptures", "Quick captures"],
  ["journalEntries", "Journal entries"],
  ["insights", "Insights"],
  ["weeklyReviews", "Weekly reviews"],
  ["weeklySnapshots", "Weekly snapshots"],
  ["dailyBriefings", "Daily briefings"],
  ["activity", "Activity events"],
];

/** How many of each kind the state holds. */
export function plannerCounts(s: PlannerState): { key: string; label: string; count: number }[] {
  return PLANNER_KINDS.map(([key, label]) => {
    const v = s[key] as unknown;
    return { key, label, count: Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0 };
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj) : []);
const rec = (v: unknown): Record<string, Record<string, unknown>> =>
  isObj(v) ? (Object.fromEntries(Object.entries(v).filter(([, x]) => isObj(x))) as Record<string, Record<string, unknown>>) : {};
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strN = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const oneOf = <T extends string>(v: unknown, set: readonly T[], d: T): T => (set.includes(v as T) ? (v as T) : d);

const goal = (g: Record<string, unknown>): Goal => ({
  id: str(g.id),
  title: str(g.title),
  category: str(g.category, "General"),
  points: num(g.points, 10),
  done: g.done === true,
  createdAt: str(g.createdAt),
  completedAt: strN(g.completedAt),
  projectId: strN(g.projectId),
});

/** Merge by id: items already here are kept untouched (they may have been edited since), new ones are added. Importing twice changes nothing. */
function mergeById<T extends { id: string }>(have: T[], incoming: T[]): T[] {
  const map = new Map(have.map((x) => [x.id, x]));
  for (const x of incoming) if (x.id && !map.has(x.id)) map.set(x.id, x);
  return [...map.values()];
}

/** Same for records keyed by date: a day or plan already here wins. */
const keepLocal = <T>(have: Record<string, T>, incoming: Record<string, T>, replaceable: (x: T) => boolean = () => false): Record<string, T> => {
  const out = { ...incoming, ...have };
  for (const k of Object.keys(have)) if (k in incoming && replaceable(have[k])) out[k] = incoming[k];
  return out;
};

/** When the template arrives with the import, a local day built from the empty template is dropped so the start screen rebuilds it with the new goals. */
const withoutEmptyDays = (days: Record<string, DailyGoals>) => Object.fromEntries(Object.entries(days).filter(([, d]) => d.isClosed || d.goals.length > 0));

/** A day that is only today's untouched copy of the goal template (nothing ticked, nothing added) has nothing worth keeping. */
const pristineDay = (d: DailyGoals) => !d.isClosed && d.goals.every((g) => !g.done && /^\d{4}-\d\d-\d\d-t\d+$/.test(g.id));

export class ImportError extends Error {}

/**
 * Reads a Linkra export bundle (`{schema_version, created_at, data}`, schema v3) into the planner state.
 * Drops what AureliaSpace has no use for: GitHub tokens, selected repos, billing and account fields,
 * the repo scan cache. Keeps goal templates from userSettings.
 */
export function importLinkra(json: unknown, into: PlannerState = emptyPlanner(), now = new Date().toISOString()): PlannerState {
  if (!isObj(json) || !isObj(json.data)) throw new ImportError("Not a Linkra export (no data).");
  if (json.schema_version !== 3) throw new ImportError(`Linkra export schema ${String(json.schema_version)} is not supported (need 3).`);
  const d = json.data;
  const s = normalizePlanner(into);

  const projects = arr(d.projects).map((p): PlannerProject => ({
    id: str(p.id),
    name: str(p.name),
    subtitle: str(p.subtitle),
    icon: str(p.icon, "🧩"),
    color: str(p.color, "#8b5cf6"),
    status: str(p.status, "Not Started"),
    progress: num(p.progress),
    githubRepo: strN(p.githubRepo),
    localRepoPath: strN(p.localRepoPath),
    archivedAt: strN(p.archivedAt),
    createdAt: str(p.createdAt),
    updatedAt: str(p.updatedAt),
    tasks: arr(p.tasks).map((t): ProjectTask => ({
      id: str(t.id),
      text: str(t.text),
      done: t.done === true,
      status: oneOf(t.status, ["todo", "doing", "done"], t.done === true ? "done" : "todo"),
      dependsOnIds: strs(t.dependsOnIds),
      priority: oneOf(t.priority, ["low", "med", "high"], "med"),
      dueDate: strN(t.dueDate),
      milestone: strN(t.milestone),
      createdAt: str(t.createdAt),
      completedAt: strN(t.completedAt),
    })),
  }));

  const days = Object.fromEntries(
    Object.entries(rec(d.dailyGoalsByDate)).map(([date, e]): [string, DailyGoals] => [
      date,
      {
        date: str(e.date, date),
        goals: arr(e.goals).map(goal),
        score: num(e.score),
        completedPoints: num(e.completedPoints),
        totalPoints: num(e.totalPoints),
        isClosed: e.isClosed === true,
        archivedAt: strN(e.archivedAt),
      },
    ]),
  );

  const plans = Object.fromEntries(
    Object.entries(rec(d.todayPlanByDate)).map(([date, e]): [string, TodayPlan] => [
      date,
      { taskIds: strs(e.taskIds), generatedAt: str(e.generatedAt), source: oneOf(e.source, ["manual", "auto"], "auto"), notes: strN(e.notes) },
    ]),
  );

  const briefings = Object.fromEntries(
    Object.entries(rec(d.dailyBriefings)).map(([date, e]): [string, DailyBriefing] => [
      date,
      { date: str(e.date, date), content: str(e.content), generatedAt: str(e.generatedAt), dismissed: e.dismissed === true },
    ]),
  );

  const roadmap = arr(d.roadmapCards).map((c): RoadmapCard => ({
    id: str(c.id),
    lane: oneOf(c.lane, ["now", "next", "later", "shipped"], "later"),
    title: str(c.title),
    description: str(c.description),
    tags: strs(c.tags),
    linkedRepo: strN(c.linkedRepo),
    linkedMilestone: strN(c.linkedMilestone),
    dueDate: strN(c.dueDate),
    project: strN(c.project),
    createdAt: str(c.createdAt),
    updatedAt: str(c.updatedAt),
  }));

  const habits = arr(d.habits).map((h): Habit => ({
    id: str(h.id),
    title: str(h.title),
    frequency: oneOf(h.frequency, ["daily", "weekdays", "custom"], "daily"),
    customDays: Array.isArray(h.customDays) ? h.customDays.filter((x): x is number => typeof x === "number") : [],
    color: str(h.color, "#7c5cfc"),
    icon: str(h.icon, "⚡"),
    linkedProjectId: strN(h.linkedProjectId),
    targetStreak: num(h.targetStreak, 30),
    createdAt: str(h.createdAt),
    updatedAt: str(h.updatedAt),
    archivedAt: strN(h.archivedAt),
  }));

  const checkins = arr(d.habitCompletions).map((c): HabitCompletion => ({
    id: str(c.id),
    habitId: str(c.habitId),
    date: str(c.date),
    createdAt: str(c.createdAt),
  }));

  const focus = arr(d.focusSessions).map((f): FocusSession => ({
    id: str(f.id),
    startedAt: str(f.startedAt),
    durationMinutes: num(f.durationMinutes),
    completedAt: strN(f.completedAt),
    planned: f.planned === true,
    projectId: strN(f.projectId),
    reason: strN(f.reason),
  }));

  const logs = arr(d.sessionLogs).map((l): SessionLog => ({ id: str(l.id), ts: str(l.ts), text: str(l.text), project: strN(l.project), tags: strs(l.tags) }));
  const captures = arr(d.quickCaptures).map((c): QuickCapture => ({
    id: str(c.id),
    type: oneOf(c.type, ["note", "task", "roadmap", "journal"], "note"),
    text: str(c.text),
    createdAt: str(c.createdAt),
  }));
  const journal = arr(d.journalEntries).map((j): JournalEntry => ({
    id: str(j.id),
    projectId: strN(j.projectId),
    ts: str(j.ts),
    type: oneOf(j.type, ["note", "decision", "blocker", "next", "idea"], "note"),
    title: strN(j.title),
    body: str(j.body),
    tags: strs(j.tags),
    createdAt: str(j.createdAt),
    updatedAt: str(j.updatedAt),
  }));
  const loose = (v: unknown) => arr(v).filter((x): x is Loose => typeof x.id === "string") as Loose[];

  const settings = isObj(d.userSettings) ? d.userSettings : {};
  const adoptTemplate = !s.goalTemplate.length && arr(settings.goalTemplate).length > 0;

  return {
    ...s,
    importedAt: now,
    projects: mergeById(s.projects, projects),
    dailyGoalsByDate: keepLocal(adoptTemplate ? withoutEmptyDays(s.dailyGoalsByDate) : s.dailyGoalsByDate, days, pristineDay),
    goalTemplate: adoptTemplate ? arr(settings.goalTemplate).map(goal) : s.goalTemplate,
    todayPlanByDate: keepLocal(s.todayPlanByDate, plans),
    roadmapCards: mergeById(s.roadmapCards, roadmap),
    habits: mergeById(s.habits, habits),
    habitCompletions: mergeById(s.habitCompletions, checkins),
    focusSessions: mergeById(s.focusSessions, focus),
    sessionLogs: mergeById(s.sessionLogs, logs),
    quickCaptures: mergeById(s.quickCaptures, captures),
    journalEntries: mergeById(s.journalEntries, journal),
    insights: mergeById(s.insights, loose(d.insights)),
    weeklyReviews: mergeById(s.weeklyReviews, loose(d.weeklyReviews)),
    weeklySnapshots: mergeById(s.weeklySnapshots, loose(d.weeklySnapshots)),
    dailyBriefings: keepLocal(s.dailyBriefings, briefings),
  };
}
