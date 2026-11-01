import { moveTo, transition, type WorkItem } from "./work.ts";

/** What a chat/turn told us when it ended (ChatEvent's turnEnd outcome). */
export type TurnOutcome = "completed" | "interrupted" | "failed";

/** A finished or failed turn needs a look: it lands in Review. An interrupted one stays where it is. */
export function afterTurnEnd(item: WorkItem, outcome: TurnOutcome): WorkItem {
  if (item.status !== "working" || outcome === "interrupted") return item;
  return transition(item, "review");
}

/** Starting a pending item puts it in progress; anything already moving is left alone. */
export function startWork(item: WorkItem): WorkItem {
  return item.status === "pending" ? transition(item, "working") : item;
}

/** "Review" on the board asks for the diff; the item waits for a verdict. */
export function requestReview(item: WorkItem): WorkItem {
  return item.status === "working" ? transition(item, "review") : item;
}

/** A merged PR settles the item wherever it was (even straight from pending). */
export function afterPrMerge(item: WorkItem): WorkItem {
  return moveTo(item, "done");
}

/** Settling a thread closes out its item. */
export function settleWork(item: WorkItem): WorkItem {
  return moveTo(item, "done");
}
