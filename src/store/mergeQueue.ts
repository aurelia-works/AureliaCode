import { create } from "zustand";
import { useChat } from "../lib/chat";
import { ipc } from "../lib/ipc";
import { active, advance, enqueue, verdictFor, type QueueEvent, type QueueItem } from "../lib/mergeQueue";
import { prNumberRef } from "../lib/threadTools";
import { useAgents } from "./agents";
import { paneDir } from "./git";
import { alertUser, warnUnreadable } from "./notifications";
import { panePr } from "./prs";
import { toast, useUi } from "./ui";
import { readSaved } from "../lib/savedState";

/** One step of the active item per tick: gh calls GitHub, so this stays slow. */
const TICK_MS = 20_000;

interface QueueState {
  items: QueueItem[];
  /** When the active item was last pushed, for the "no checks yet" grace period. */
  syncedAt: Record<string, number>;
}

export const useMergeQueue = create<QueueState>(() => ({ items: [], syncedAt: {} }));

export const queueItemOf = (items: QueueItem[], paneId: string) => items.find((i) => i.paneId === paneId);

/** False when mergequeue.json couldn't be read: the queue there isn't replaced by this session's. */
let canSave = true;

function save() {
  if (!canSave) return;
  // Merged items don't need to come back after a restart; bounced ones stay until you act on them.
  void ipc.saveState("mergequeue", useMergeQueue.getState().items.filter((i) => i.stage !== "merged")).catch(() => {});
}

function put(next: QueueItem) {
  useMergeQueue.setState((s) => ({ items: s.items.map((i) => (i.paneId === next.paneId ? next : i)) }));
  save();
}

export function addToQueue(paneId: string) {
  const pr = panePr(paneId);
  if (!pr || pr.state !== "OPEN") return toast("This thread has no open PR to queue.", true);
  useMergeQueue.setState((s) => ({ items: enqueue(s.items, paneId, pr.number, Date.now()) }));
  save();
  toast(`${prNumberRef(pr.number)} is in the merge queue`);
  void tick();
}

export function removeFromQueue(paneId: string) {
  useMergeQueue.setState((s) => ({ items: s.items.filter((i) => i.paneId !== paneId) }));
  save();
}

/** Rebasing under a thread that is still working would pull files out from under it. */
function threadBusy(paneId: string) {
  const s = useAgents.getState().sessions[paneId]?.status;
  const c = useChat.getState().byPane[paneId]?.status;
  return s === "working" || s === "starting" || c === "working" || c === "starting";
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The next event for the active item, or null to wait. */
async function step(item: QueueItem, dir: string): Promise<QueueEvent | null> {
  const pr = await ipc.prStatus(dir);
  if (!pr || pr.number !== item.pr) return { type: "error", message: "This branch no longer has that PR" };
  if (pr.state === "MERGED") return { type: "prMerged" };
  if (pr.state === "CLOSED") return { type: "error", message: "The PR was closed" };
  switch (item.stage) {
    case "queued":
      return threadBusy(item.paneId) ? null : { type: "start" };
    case "syncing": {
      const r = await ipc.prSync(dir);
      if (r.conflict) return { type: "conflict" };
      useMergeQueue.setState((s) => ({ syncedAt: { ...s.syncedAt, [item.paneId]: Date.now() } }));
      return { type: "synced", sha: r.sha };
    }
    case "checks": {
      const since = useMergeQueue.getState().syncedAt[item.paneId];
      return { type: "checks", checks: pr.checks, failing: pr.failing, sinceSyncMs: since ? Date.now() - since : undefined };
    }
    case "verdict": {
      const c = await ipc.prComments(dir);
      if (item.sha && c.headRefOid !== item.sha) return { type: "error", message: "New commits landed after the rebase: queue it again" };
      return { type: "verdict", verdict: verdictFor(c.comments ?? [], item.sha ?? c.headRefOid) };
    }
    case "merging":
      // Removed while the verdict was being read: don't merge.
      if (!queueItemOf(useMergeQueue.getState().items, item.paneId)) return null;
      await ipc.prMerge(dir, item.sha!);
      return { type: "merged" };
  }
  return null;
}

let running = false;

export async function tick() {
  if (running || !useUi.getState().prefs.mergeQueue) return;
  running = true;
  try {
    // Several steps can run back to back (sync, then checks); stop when one has to wait.
    for (let n = 0; n < 6; n++) {
      const item = active(useMergeQueue.getState().items);
      if (!item) return;
      const dir = paneDir(item.paneId);
      const ev: QueueEvent | null = dir ? await step(item, dir).catch((e) => ({ type: "error" as const, message: errText(e) })) : { type: "error", message: "The thread is gone" };
      if (!ev) return;
      // Removed from the queue while gh was running.
      if (!queueItemOf(useMergeQueue.getState().items, item.paneId)) return;
      const next = advance(item, ev);
      if (next.stage === item.stage) return;
      put(next);
      if (next.stage === "merged") toast(`Merged ${prNumberRef(item.pr)} from the queue`);
      if (next.stage === "bounced")
        alertUser({ kind: "info", paneId: item.paneId, title: `${prNumberRef(item.pr)} left the merge queue`, body: next.reason ?? "" });
    }
  } finally {
    running = false;
  }
}

export async function startMergeQueue() {
  const r = await readSaved(() => ipc.loadState<QueueItem[]>("mergequeue"));
  if (!r.ok) {
    canSave = false;
    warnUnreadable("mergequeue.json", r.error);
  }
  const saved = r.ok ? r.value : null;
  if (Array.isArray(saved)) {
    // A sync cut off by a quit starts over: it refuses a dirty tree and rebasing twice is harmless.
    useMergeQueue.setState({ items: saved.map((i) => (i.stage === "syncing" || i.stage === "checks" ? { ...i, stage: "queued" } : i)) });
  }
  setInterval(() => void tick(), TICK_MS);
}
