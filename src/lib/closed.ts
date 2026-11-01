/** Recently closed threads, so ⌘⇧T and Undo can reopen them. Pure list handling; reopening itself is in reopen.ts. */

export interface ClosedPane {
  /** The pane id it had while open; the durable store updates this row instead of adding a duplicate. */
  id?: string;
  cwd?: string;
  account?: string;
  agent?: string;
  customAgent?: string;
  mode?: "chat" | "terminal";
  browserUrl?: string;
  /** Carried over so a reopened thread continues: its conversation and chat settings. */
  carry: Record<string, unknown>;
}

/** One close action: a thread, or every pane of a closed tab. */
export interface ClosedGroup {
  at: number;
  panes: ClosedPane[];
}

export const CLOSED_CAP = 20;

/** Pane fields that make a reopened thread pick up where it left off. A reopened thread is active, so `settled` is not carried (that would re-run the settle side effects). */
export const CARRY_KEYS = ["title", "pinned", "env", "secretEnv", "chatFork", "prSeenFeedback", "claudeSession", "chatModel", "chatEffort", "chatStyle", "chatPermission", "chatUsed", "chatTokens", "chatCost", "cardId", "babysit", "babysitWakes"] as const;

export function snapshot(meta: Record<string, any>): ClosedPane | null {
  // Empty start tabs and file editors have nothing worth reopening.
  if (meta.launcher || meta.editor) return null;
  const carry: Record<string, unknown> = {};
  for (const k of CARRY_KEYS) if (meta[k] !== undefined) carry[k] = meta[k];
  return {
    id: meta.id,
    cwd: meta.cwd,
    account: meta.account,
    agent: meta.agent,
    customAgent: meta.customAgent,
    mode: meta.mode,
    browserUrl: meta.browser ? meta.browser.url : undefined,
    carry,
  };
}

/** Newest last; capped. A group of nothing reopenable is not recorded. */
export function pushClosed(list: ClosedGroup[], panes: (ClosedPane | null)[], at: number): ClosedGroup[] {
  const real = panes.filter((p): p is ClosedPane => !!p);
  if (!real.length) return list;
  return [...list, { at, panes: real }].slice(-CLOSED_CAP);
}

export function popClosed(list: ClosedGroup[]): { list: ClosedGroup[]; group?: ClosedGroup } {
  const group = list.at(-1);
  return { list: list.slice(0, -1), group };
}
