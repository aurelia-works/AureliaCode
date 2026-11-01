import { useLayout, type PaneMeta } from "../store/layout";
import { usePlanner } from "../store/planner";
import { offerUndo } from "../store/undo";
import { undoShip } from "./plannerRoadmap";
import { previous, undoLabel } from "./undo";
import { workSettled } from "./workBridge";

/**
 * Applies `patch` to threads and offers Undo ("Settled 2 threads") that restores what it overwrote.
 * Settling also ships roadmap cards and logs activity (store/planner.ts watchSettled), so undoing a settle takes those back too.
 */
export function patchThreads(ids: string[], patch: Partial<PaneMeta>, verb: string) {
  const layout = useLayout.getState();
  const before = ids.map((id) => [id, previous(layout.panes[id] ?? {}, patch)] as const);
  const plannerBefore = usePlanner.getState().data;
  const cardIds = patch.settled === true ? ids.map((id) => layout.panes[id]?.cardId).filter((c): c is string => !!c) : [];
  for (const id of ids) layout.updatePane(id, patch);
  if (patch.settled === true) ids.forEach(workSettled);
  offerUndo(undoLabel(verb, ids.length), () => {
    // A pane closed since is simply skipped.
    for (const [id, prev] of before) if (useLayout.getState().panes[id]) useLayout.getState().updatePane(id, prev);
    if (patch.settled === true) usePlanner.getState().update((cur) => undoShip(cur, plannerBefore, cardIds, ids.length));
  });
}
