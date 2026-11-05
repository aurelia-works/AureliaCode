import { create } from "zustand";
import { emptyNav, prune, step, visit, type NavHistory } from "../lib/navHistory";
import { showPane } from "../lib/terminals";
import { focusedPaneId, useLayout } from "./layout";
import { toast } from "./ui";

export const useNav = create<{ h: NavHistory }>(() => ({ h: emptyNav() }));

/** True while ⌘[ / ⌘] move focus, so those moves are not recorded as new visits. */
let navigating = false;

/** Records every thread you focus. Call once the layout is hydrated. */
export function startNavHistory() {
  const record = () => {
    const id = focusedPaneId();
    if (id && !navigating) useNav.setState((s) => ({ h: visit(prune(s.h, (p) => !!useLayout.getState().panes[p]), id) }));
  };
  record();
  useLayout.subscribe((s, prev) => {
    const cur = s.tabs.find((t) => t.id === s.activeTabId)?.focusedPaneId;
    const was = prev.tabs.find((t) => t.id === prev.activeTabId)?.focusedPaneId;
    if (cur !== was) record();
  });
}

/** ⌘[ (dir -1) and ⌘] (dir +1): the previous or next thread you were in. */
export function navigate(dir: -1 | 1): boolean {
  const r = step(useNav.getState().h, dir, (id) => !!useLayout.getState().panes[id]);
  if (!r.id) {
    toast(dir === -1 ? "No earlier thread" : "No later thread");
    return false;
  }
  navigating = true;
  useNav.setState({ h: r.h });
  showPane(r.id);
  // Focus changes land in the layout store synchronously; release the flag after they have.
  queueMicrotask(() => (navigating = false));
  return true;
}
