import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { migrateTasks, transition, WORK_STATUSES, type WorkItem, type WorkStatus } from "../lib/work";
import { uid } from "./layout";
import { useTasks } from "./tasks";

/** A thread (or its absence) attached to a work item. */
export interface WorkThread {
  threadId?: string;
  paneId?: string;
  harness?: WorkItem["harness"];
  model?: string;
  effort?: string;
  worktree?: WorkItem["worktree"];
  branch?: string;
}

export type NewWork = Pick<WorkItem, "title" | "project"> & Partial<Omit<WorkItem, "id" | "createdAt" | "updatedAt">>;

interface WorkState {
  items: WorkItem[];
  /** Set when work.json exists but could not be read: the board stays empty and is not saved over it. */
  loadError: string | null;
  /** Reads persisted work, or migrates the old per-project tasks on first run. */
  load(): Promise<void>;
  add(input: NewWork): WorkItem;
  update(id: string, patch: Partial<Omit<WorkItem, "id" | "status" | "createdAt" | "updatedAt">>): void;
  remove(id: string): void;
  setStatus(id: string, status: WorkStatus): void;
  attachThread(id: string, thread: WorkThread): void;
  attachWorktree(id: string, worktree: NonNullable<WorkItem["worktree"]>): void;
  attachPr(id: string, pr: WorkItem["pr"]): void;
  linkCard(id: string, cardId: string | undefined): void;
  /** A merged PR or a settled thread finishes the item wherever it was. */
  finish(id: string): void;
}

let subscribed = false;
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function save() {
  if (!loaded) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!useWork.getState().loadError) ipc.saveState("work", { items: useWork.getState().items }).catch(() => {});
  }, 400);
}

/** Writes now, for the window's beforeunload handler. */
export function flushWork() {
  clearTimeout(saveTimer);
  if (!loaded || useWork.getState().loadError) return Promise.resolve();
  return ipc.saveState("work", { items: useWork.getState().items }).catch(() => {});
}

function isWorkItem(v: unknown): v is WorkItem {
  const x = v as WorkItem;
  return (
    !!x &&
    typeof x.id === "string" &&
    typeof x.title === "string" &&
    typeof x.project === "string" &&
    WORK_STATUSES.includes(x.status) &&
    typeof x.createdAt === "number" &&
    typeof x.updatedAt === "number"
  );
}

export const useWork = create<WorkState>((set, get) => {
  const change = (id: string, fn: (item: WorkItem) => WorkItem) =>
    set((s) => ({ items: s.items.map((i) => (i.id === id ? fn(i) : i)) }));
  return {
    items: [],
    loadError: null,
    async load() {
      if (loaded) return;
      let saved: { items?: unknown } | null;
      try {
        saved = await ipc.loadState<{ items?: unknown }>("work");
      } catch (e) {
        // A read error is not "first run": never migrate or save over the real file.
        set({ loadError: `Couldn't read work.json: ${e}` });
        return;
      }
      let stored: WorkItem[] | null = null;
      if (saved != null) {
        if (!Array.isArray(saved.items)) {
          set({ loadError: "work.json has an unexpected shape; the board was not changed." });
          return;
        }
        stored = saved.items.filter(isWorkItem);
        if (stored.length !== saved.items.length) {
          set({ loadError: "work.json has invalid items; the board was not changed." });
          return;
        }
      }
      loaded = true;
      // No file yet (first run on this build): carry the old tasks over once. An
      // empty saved array is a real answer, so a user who cleared the board keeps it clear.
      const items = stored ?? migrateTasks(useTasks.getState().projects);
      set({ items, loadError: null });
      if (!subscribed) {
        subscribed = true;
        useWork.subscribe((s, prev) => {
          if (s.items !== prev.items) save();
        });
      }
      if (!stored && items.length) save();
    },
    add(input) {
      const now = Date.now();
      const item: WorkItem = {
        ...input,
        id: uid("work"),
        title: input.title.trim() || "Untitled work",
        status: input.status ?? "pending",
        createdAt: now,
        updatedAt: now,
      };
      set((s) => ({ items: [...s.items, item] }));
      return item;
    },
    update: (id, patch) => change(id, (i) => ({ ...i, ...patch, updatedAt: Math.max(Date.now(), i.updatedAt + 1) })),
    remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
    setStatus(id, status) {
      const item = get().items.find((i) => i.id === id);
      if (!item) return;
      if (!WORK_STATUSES.includes(status)) return;
      try {
        const next = transition(item, status);
        if (next !== item) change(id, () => next);
      } catch {
        // The board refuses illegal moves by not offering them; a stray call is ignored.
      }
    },
    attachThread: (id, thread) => change(id, (i) => ({ ...i, ...thread, updatedAt: Math.max(Date.now(), i.updatedAt + 1) })),
    attachWorktree: (id, worktree) => change(id, (i) => ({ ...i, worktree, branch: worktree.branch, updatedAt: Math.max(Date.now(), i.updatedAt + 1) })),
    attachPr: (id, pr) => change(id, (i) => ({ ...i, pr, updatedAt: Math.max(Date.now(), i.updatedAt + 1) })),
    linkCard: (id, cardId) => change(id, (i) => ({ ...i, cardId, updatedAt: Math.max(Date.now(), i.updatedAt + 1) })),
    finish: (id) => change(id, (i) => (i.status === "done" ? i : { ...i, status: "done", updatedAt: Math.max(Date.now(), i.updatedAt + 1) })),
  };
});

/** Items for one project, for the queue rail or a project page. */
export function workForProject(items: WorkItem[], project: string): WorkItem[] {
  return items.filter((i) => i.project === project);
}
