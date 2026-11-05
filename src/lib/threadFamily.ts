/** Which thread started which (Theo, 2026-11-04 03:16: "use the orchestrator capabilities"). A pane opened by another
 *  agent through `aurelia_open_pane` keeps the opener's id in `openedBy`; this links them both ways for the cards. */

export interface Family {
  parent?: string;
  children: string[];
}

export function familyOf(panes: Record<string, { id: string; openedBy?: string }>, id: string): Family {
  const by = panes[id]?.openedBy;
  const parent = by && by !== id && panes[by] ? by : undefined;
  const children = Object.values(panes)
    .filter((p) => p.openedBy === id && p.id !== id)
    .map((p) => p.id)
    .sort();
  return { parent, children };
}
