/**
 * A grid-card picker menu keeps its left edge on its own trigger. The width is the
 * room from that edge to the pane, so a longer or shorter label cannot slide the menu.
 */
export function anchoredMenuWidth(triggerLeft: number, paneRight: number, cap = 330, inset = 8): number {
  const room = paneRight - triggerLeft - inset;
  if (room <= 0) return 0;
  return Math.min(cap, room);
}

/** The complete row: its name, then the subtitle when the row has one and it isn't a repeat. */
export function pickFullText(label: string, desc?: string): string {
  const name = label.trim();
  const sub = (desc ?? "").trim();
  return sub && sub !== name ? `${name}. ${sub}` : name;
}
