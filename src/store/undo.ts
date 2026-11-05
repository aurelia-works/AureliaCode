import { create } from "zustand";
import { popClosed, pushClosed, type ClosedGroup, type ClosedPane } from "../lib/closed";
import { latestEntry, makeEntry, pushEntry, withoutEntry, type UndoEntry } from "../lib/undo";
import { useUi } from "./ui";

interface UndoStore {
  entries: UndoEntry[];
  closed: ClosedGroup[];
}

export const useUndo = create<UndoStore>(() => ({ entries: [], closed: [] }));

/** Offers an Undo for `label`. `run` puts things back. */
export function offerUndo(label: string, run: () => void) {
  const now = Date.now();
  useUndo.setState((s) => ({ entries: pushEntry(s.entries, makeEntry(label, run, now, useUi.getState().prefs.undoSeconds * 1000), now) }));
}

/** Whether an undo is on offer right now. */
export const hasUndo = () => !!latestEntry(useUndo.getState().entries, Date.now());

/** Runs the newest live undo. Returns false when there is nothing to undo. */
export function runUndo(): boolean {
  const { entries } = useUndo.getState();
  const e = latestEntry(entries, Date.now());
  if (!e) return false;
  useUndo.setState({ entries: withoutEntry(entries, e.id) });
  e.run();
  return true;
}

/** Remembers closed panes for ⌘⇧T. */
export function rememberClosed(panes: (ClosedPane | null)[]) {
  useUndo.setState((s) => ({ closed: pushClosed(s.closed, panes, Date.now()) }));
}

/** Drops one group from the closed stack (it was reopened by Undo). */
export function forgetClosed(group: ClosedGroup) {
  useUndo.setState((s) => ({ closed: s.closed.filter((g) => g !== group) }));
}

/** Takes the newest closed group off the stack. */
export function takeClosed(): ClosedGroup | undefined {
  const { list, group } = popClosed(useUndo.getState().closed);
  if (group) useUndo.setState({ closed: list });
  return group;
}
