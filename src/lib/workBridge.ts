import { useWork } from "../store/work";
import { afterTurnEnd, type TurnOutcome } from "./workActions";

/** The impure half of the work graph: apply a transition to whichever item owns a pane. */

/** A finished/failed turn sends a working item to Review; an interrupted one stays put. */
export function workAfterTurn(paneId: string, outcome: TurnOutcome) {
  const item = useWork.getState().items.find((i) => i.paneId === paneId);
  if (!item) return;
  const next = afterTurnEnd(item, outcome);
  if (next !== item) useWork.getState().setStatus(item.id, next.status);
}

/** A settled thread or merged PR finishes the item that owns the pane. */
export function workSettled(paneId: string) {
  const item = useWork.getState().items.find((i) => i.paneId === paneId);
  if (item) useWork.getState().finish(item.id);
}
