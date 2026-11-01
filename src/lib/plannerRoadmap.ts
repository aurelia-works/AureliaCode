import type { RoadmapCard, RoadmapLane, PlannerState } from "./planner.ts";
import { newId, tally } from "./plannerToday.ts";
import { addActivity } from "./plannerWeekly.ts";

export const LANES: { id: RoadmapLane; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "next", label: "Next" },
  { id: "later", label: "Later" },
  { id: "shipped", label: "Shipped" },
];

/** A project's cards in each lane (all projects when `projectId` is null). */
export function lanesFor(s: PlannerState, projectId: string | null): Record<RoadmapLane, RoadmapCard[]> {
  const out: Record<RoadmapLane, RoadmapCard[]> = { now: [], next: [], later: [], shipped: [] };
  for (const c of s.roadmapCards) if (projectId === null || c.project === projectId) out[c.lane].push(c);
  return out;
}

const touch = (s: PlannerState, id: string, fn: (c: RoadmapCard) => RoadmapCard, now: string): PlannerState => ({
  ...s,
  roadmapCards: s.roadmapCards.map((c) => (c.id === id ? { ...fn(c), updatedAt: now } : c)),
});

export function addCard(s: PlannerState, projectId: string | null, title: string, lane: RoadmapLane = "next", now = new Date().toISOString()): PlannerState {
  const t = title.trim();
  if (!t) return s;
  const card: RoadmapCard = { id: newId("c"), lane, title: t, description: "", tags: [], linkedRepo: null, linkedMilestone: null, dueDate: null, project: projectId, goalId: null, createdAt: now, updatedAt: now };
  return { ...s, roadmapCards: [...s.roadmapCards, card] };
}
const setLane = (s: PlannerState, id: string, lane: RoadmapLane, now: string) =>
  s.roadmapCards.some((c) => c.id === id && c.lane !== lane) ? touch(s, id, (c) => ({ ...c, lane }), now) : s;
/** Moving a card to Shipped by hand ships it like a settled thread would: the event is logged and its goal ticked. */
export const moveCard = (s: PlannerState, id: string, lane: RoadmapLane, now = new Date().toISOString()) => (lane === "shipped" ? shipCard(s, id, now) : setLane(s, id, lane, now));
export const editCard = (s: PlannerState, id: string, patch: Partial<Pick<RoadmapCard, "title" | "description" | "dueDate" | "goalId">>, now = new Date().toISOString()) => touch(s, id, (c) => ({ ...c, ...patch }), now);
export const removeCard = (s: PlannerState, id: string): PlannerState => ({ ...s, roadmapCards: s.roadmapCards.filter((c) => c.id !== id) });

/** The first message of a thread started from a card. */
export const cardPrompt = (c: RoadmapCard) => (c.description.trim() ? `${c.title}\n\n${c.description.trim()}` : c.title);

/** A thread starts on a card: it moves to Now unless it is already there or shipped. */
export const startCard = (s: PlannerState, id: string, now = new Date().toISOString()) => {
  const c = s.roadmapCards.find((x) => x.id === id);
  return c && (c.lane === "next" || c.lane === "later") ? setLane(s, id, "now", now) : s;
};

/** The card's thread is done: the card ships and its linked goal (on any day) is ticked. */
export function shipCard(s: PlannerState, id: string, now = new Date().toISOString()): PlannerState {
  const card = s.roadmapCards.find((c) => c.id === id);
  if (!card || card.lane === "shipped") return s;
  let out = addActivity(setLane(s, id, "shipped", now), "card-shipped", card.title, now);
  if (card.goalId) {
    const days = { ...out.dailyGoalsByDate };
    for (const [date, day] of Object.entries(days)) {
      if (day.isClosed || !day.goals.some((g) => g.id === card.goalId && !g.done)) continue;
      days[date] = tally({ ...day, goals: day.goals.map((g) => (g.id === card.goalId ? { ...g, done: true, completedAt: now } : g)) });
    }
    out = { ...out, dailyGoalsByDate: days };
  }
  return out;
}

/**
 * Takes back what settling threads did to the planner: a card that shipped goes back to its old lane, its goal is
 * unticked, and the activity rows the settle added are removed. `before` is the planner state from just before the settle; `settledCount` is how many threads it settled (one activity row each).
 */
export function undoShip(cur: PlannerState, before: PlannerState, cardIds: string[], settledCount = cardIds.length): PlannerState {
  let out = cur;
  let reverted = 0;
  for (const id of cardIds) {
    const was = before.roadmapCards.find((c) => c.id === id);
    const now = out.roadmapCards.find((c) => c.id === id);
    if (!was || !now || was.lane === "shipped" || now.lane !== "shipped") continue;
    reverted++;
    // Only what shipping changed goes back; edits made to the card since (title, notes, due date) stay.
    out = { ...out, roadmapCards: out.roadmapCards.map((c) => (c.id === id ? { ...c, lane: was.lane, updatedAt: was.updatedAt } : c)) };
    if (was.goalId) {
      const days = { ...out.dailyGoalsByDate };
      for (const [date, day] of Object.entries(days)) {
        const goalBefore = before.dailyGoalsByDate[date]?.goals.find((g) => g.id === was.goalId);
        if (!goalBefore || goalBefore.done || !day.goals.some((g) => g.id === was.goalId && g.done)) continue;
        days[date] = tally({ ...day, goals: day.goals.map((g) => (g.id === was.goalId ? goalBefore : g)) });
      }
      out = { ...out, dailyGoalsByDate: days };
    }
  }
  // The activity this settle logged: at most one "settled" per thread and one "shipped" per reverted card, newest first.
  const known = new Set(before.activity.map((a) => a.id));
  const fresh = out.activity.filter((a) => !known.has(a.id));
  const drop = new Set<string>();
  let settledLeft = settledCount;
  let shippedLeft = reverted;
  for (const a of [...fresh].reverse()) {
    if (a.kind === "card-shipped" && shippedLeft > 0) (shippedLeft--, drop.add(a.id));
    else if (a.kind === "thread-settled" && settledLeft > 0) (settledLeft--, drop.add(a.id));
  }
  return drop.size ? { ...out, activity: out.activity.filter((a) => !drop.has(a.id)) } : out;
}

interface PaneLike {
  settled?: boolean;
  cardId?: string;
}
/** Pane ids that went from not settled to settled between two layout states. */
export function settledIds(prev: Record<string, PaneLike>, next: Record<string, PaneLike>): string[] {
  return Object.entries(next).filter(([id, p]) => p.settled && id in prev && !prev[id].settled).map(([id]) => id);
}

/** Card ids whose thread went from not settled to settled between two layout states (a pane that is new in `next`, such as one restored from disk, never counts). */
export function newlySettled(prev: Record<string, PaneLike>, next: Record<string, PaneLike>): string[] {
  const out: string[] = [];
  for (const [id, p] of Object.entries(next)) if (p.settled && p.cardId && id in prev && !prev[id].settled) out.push(p.cardId);
  return out;
}
