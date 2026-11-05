// Whether a tab's grid of panes fits the stage. Below the minimum, the tab shows only its
// focused pane (the others stay mounted) instead of squeezing every pane to a sliver.
import type { LayoutNode } from "../store/layout.ts";

/** Narrowest a grid pane may be before the grid folds to one pane. */
export const PANE_MIN_WIDTH = 260;

/** The stage width this layout needs so that every pane gets at least `min` px at its current ratios. */
export function layoutMinWidth(node: LayoutNode, min = PANE_MIN_WIDTH): number {
  if (node.type === "pane") return min;
  const a = layoutMinWidth(node.a, min);
  const b = layoutMinWidth(node.b, min);
  if (node.dir === "column") return Math.max(a, b);
  // Side by side: each child gets its share of the width, so the narrow share sets the need.
  const r = Math.min(0.95, Math.max(0.05, node.ratio));
  return Math.max(a / r, b / (1 - r));
}

/** True when the grid fits `width`. An unmeasured stage (0) counts as fitting. */
export function gridFits(node: LayoutNode, width: number, min = PANE_MIN_WIDTH): boolean {
  return width <= 0 || node.type === "pane" || width >= layoutMinWidth(node, min) - 0.5;
}
