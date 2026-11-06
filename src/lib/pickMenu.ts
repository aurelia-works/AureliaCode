/**
 * A grid-card picker menu keeps its left edge on its own trigger. The width is the
 * room from that edge to the pane, so a longer or shorter label cannot slide the menu.
 */
export function anchoredMenuWidth(triggerLeft: number, paneRight: number, cap = 330, inset = 8): number {
  const room = paneRight - triggerLeft - inset;
  if (room <= 0) return 0;
  return Math.min(cap, room);
}

/**
 * Where a picker tooltip's top edge goes.
 *
 * Prefer just above the control, inside the pane. On a grid card the model control
 * sits on the lower edge: that upward tip covers Check now / Stop goal and the
 * composer field. Stay under the goal actions and off the field when the pane
 * has room; otherwise pin just under the actions, still inside the pane.
 */
export function pickTipTop(args: {
  anchorTop: number;
  anchorBottom: number;
  tipHeight: number;
  minTop: number;
  maxBottom: number;
  actionsBottom?: number;
  fieldTop?: number;
  fieldBottom?: number;
  gap?: number;
}): number {
  const gap = args.gap ?? 6;
  const h = args.tipHeight;
  const maxTop = args.maxBottom - h;
  const above = args.anchorTop - h - gap;
  const below = args.anchorBottom + gap;
  const inPane = (top: number) => top >= args.minTop - 0.5 && top <= maxTop + 0.5;
  const misses = (top: number, a: number, b: number) => top + h <= a + 0.5 || top >= b - 0.5;
  const clears = (top: number) => {
    if (args.actionsBottom != null && top < args.actionsBottom + 4) return false;
    if (args.fieldTop != null && args.fieldBottom != null && !misses(top, args.fieldTop, args.fieldBottom)) return false;
    return true;
  };
  if (inPane(above) && clears(above)) return above;
  if (inPane(below) && clears(below)) return below;
  if (args.fieldBottom != null) {
    const under = Math.min(args.fieldBottom + 4, maxTop);
    if (inPane(under) && clears(under)) return under;
  }
  if (args.actionsBottom != null) {
    const floor = Math.max(args.minTop, args.actionsBottom + 4);
    if (floor <= maxTop) return floor;
  }
  if (inPane(above)) return above;
  return Math.min(Math.max(args.minTop, below), Math.max(args.minTop, maxTop));
}

/** The complete row: its name, then the subtitle when the row has one and it isn't a repeat. */
export function pickFullText(label: string, desc?: string): string {
  const name = label.trim();
  const sub = (desc ?? "").trim();
  return sub && sub !== name ? `${name}. ${sub}` : name;
}
