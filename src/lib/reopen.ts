import type { ClosedGroup, ClosedPane } from "./closed";
import { undoLabel } from "./undo";
import { queueInit } from "./terminals";
import { persistClosedThread } from "./threadStore";
import { useLayout } from "../store/layout";
import { forgetClosed, offerUndo, rememberClosed, takeClosed, useUndo } from "../store/undo";
import { toast } from "../store/ui";

/** A closed thread comes back as a new tab in the same folder; its conversation resumes where it left off. */
function reopenPane(p: ClosedPane) {
  const layout = useLayout.getState();
  const id = layout.newTab({ cwd: p.cwd, account: p.account, agent: p.agent, customAgent: p.customAgent, mode: p.mode, browserUrl: p.browserUrl });
  if (Object.keys(p.carry).length) layout.updatePane(id, p.carry);
  // A terminal Claude resumes through the CLI; a chat resumes from `claudeSession` when it mounts.
  const session = p.carry.claudeSession;
  if (p.mode !== "chat" && p.account && typeof session === "string" && /^[0-9a-f-]{36}$/i.test(session)) queueInit(id, `claude --resume ${session}`);
}

export function reopenGroup(g: ClosedGroup) {
  for (const p of g.panes) reopenPane(p);
}

/** ⌘⇧T: reopen the most recently closed thread. Returns false when there is none. */
export function reopenLastClosed(): boolean {
  const g = takeClosed();
  if (!g) {
    toast("No closed thread to reopen");
    return false;
  }
  reopenGroup(g);
  return true;
}

/** Call right after closing threads: they join the ⌘⇧T stack and an Undo is offered. */
export function recordClosed(snaps: (ClosedPane | null)[]) {
  const real = snaps.filter((p): p is ClosedPane => !!p);
  if (!real.length) return;
  // Keep a durable copy for search and for the history after the in-memory stack is gone.
  const at = Date.now();
  real.forEach((p, i) =>
    void persistClosedThread(p.id ?? `closed-${at}-${i}`, {
      ...p.carry,
      cwd: p.cwd,
      account: p.account,
      agent: p.agent,
      customAgent: p.customAgent,
      mode: p.mode,
      browser: p.browserUrl !== undefined ? { url: p.browserUrl } : undefined,
      title: typeof p.carry.title === "string" ? p.carry.title : undefined,
    }),
  );
  rememberClosed(real);
  const group = useUndo.getState().closed.at(-1)!;
  offerUndo(undoLabel("Closed", real.length), () => {
    // ⌘⇧T may already have reopened this group; doing it twice would run two Claudes on one conversation.
    if (!useUndo.getState().closed.includes(group)) return;
    forgetClosed(group);
    reopenGroup(group);
  });
}
