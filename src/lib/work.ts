/** The durable work graph: one item per unit of work, across projects. */

export type WorkStatus = "pending" | "working" | "review" | "done";

export const WORK_STATUSES: WorkStatus[] = ["pending", "working", "review", "done"];

export const WORK_TITLES: Record<WorkStatus, string> = {
  pending: "Pending",
  working: "In progress",
  review: "Review",
  done: "Done",
};

export interface WorkPr {
  number: number;
  url: string;
  /** "OPEN" | "MERGED" | "CLOSED" (as GitHub reports it). */
  state: string;
}

export interface WorkItem {
  id: string;
  title: string;
  description?: string;
  /** Project root (git root, or cwd outside a repo), like store/tasks. */
  project: string;
  status: WorkStatus;
  harness?: "claude" | "codex";
  model?: string;
  effort?: string;
  /** The agent session that owns this item, and the pane showing it. */
  threadId?: string;
  paneId?: string;
  worktree?: { path: string; branch: string };
  branch?: string;
  pr?: WorkPr;
  /** Planner roadmap card this item came from, and the goal above it. */
  cardId?: string;
  goalId?: string;
  createdAt: number;
  updatedAt: number;
}

/** Status changes the board allows. Anything else is refused, not silently applied. */
const ALLOWED: Record<WorkStatus, WorkStatus[]> = {
  pending: ["working"],
  working: ["pending", "review"],
  review: ["working", "done"],
  done: ["review"],
};

export function canTransition(from: WorkStatus, to: WorkStatus): boolean {
  return from === to || ALLOWED[from].includes(to);
}

/** Moves an item without validating; for state the outside world settled (a merged PR, a turn ending). */
export function moveTo(item: WorkItem, status: WorkStatus, at = Date.now()): WorkItem {
  if (item.status === status) return item;
  return { ...item, status, updatedAt: Math.max(at, item.updatedAt + 1) };
}

/** Validated transition: throws on a move the board does not allow. */
export function transition(item: WorkItem, status: WorkStatus): WorkItem {
  if (item.status === status) return item;
  if (!canTransition(item.status, status)) throw new Error(`cannot move work from ${item.status} to ${status}`);
  return moveTo(item, status);
}

export interface WorkColumn {
  status: WorkStatus;
  title: string;
  items: WorkItem[];
}

/** The board's four columns, always in this order; item order within a column is kept. */
export function groupBoard(items: WorkItem[]): WorkColumn[] {
  return WORK_STATUSES.map((status) => ({
    status,
    title: WORK_TITLES[status],
    items: items.filter((i) => i.status === status),
  }));
}

/** The part of a task in store/tasks.ts that migration reads; kept structural so lib stays pure. */
export interface LegacyTask {
  id: string;
  title: string;
  status: string;
  paneId?: string;
  createdAt?: number;
}

const FROM_TASK: Record<string, WorkStatus> = { todo: "pending", doing: "working", done: "done" };

/**
 * Existing per-project tasks as work items. Titles, statuses and pane links are kept,
 * the project key becomes `project`, and ids stay stable so a link survives the move.
 */
export function migrateTasks(projects: Record<string, LegacyTask[]>): WorkItem[] {
  const out: WorkItem[] = [];
  for (const [project, tasks] of Object.entries(projects ?? {})) {
    for (const t of tasks ?? []) {
      if (!t || typeof t.id !== "string" || typeof t.title !== "string") continue;
      const at = typeof t.createdAt === "number" ? t.createdAt : Date.now();
      out.push({
        id: t.id,
        title: t.title,
        project,
        status: FROM_TASK[t.status] ?? "pending",
        paneId: t.paneId,
        createdAt: at,
        updatedAt: at,
      });
    }
  }
  return out;
}

/** The part of a planner roadmap card that becomes work; structural, so lib stays pure. */
export interface PlannerCard {
  id: string;
  title: string;
  description?: string;
  lane?: string;
  project?: string;
}

/**
 * A roadmap card as work. A shipped card is done; everything else starts pending, so
 * the board's own transitions decide when it is running.
 */
export function workFromCard(card: PlannerCard, projectPath: string, at = Date.now()): WorkItem {
  return {
    id: `work-${card.id}`,
    title: card.title,
    description: card.description || undefined,
    project: projectPath,
    status: card.lane === "shipped" ? "done" : "pending",
    cardId: card.id,
    createdAt: at,
    updatedAt: at,
  };
}
