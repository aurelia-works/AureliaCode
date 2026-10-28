import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { toast } from "./ui";
import { newlySettled, settledIds, shipCard } from "../lib/plannerRoadmap";
import { addActivity } from "../lib/plannerWeekly";
import { basename } from "../lib/format";
import { useLayout } from "./layout";
import { emptyPlanner, importLinkra, normalizePlanner, type PlannerState, type PlannerSwitches } from "../lib/planner";

interface PlannerStore {
  data: PlannerState;
  loaded: boolean;
  /** Applies a pure planner transform (src/lib/plannerToday.ts etc.). */
  update(fn: (s: PlannerState) => PlannerState): void;
  setSwitch(key: keyof PlannerSwitches, on: boolean): void;
  /** Throws ImportError on a file that isn't a Linkra v3 export. */
  importLinkraText(text: string): PlannerState;
}

export const usePlanner = create<PlannerStore>((set, get) => ({
  data: emptyPlanner(),
  loaded: false,
  update: (fn) => set((s) => ({ data: fn(s.data) })),
  setSwitch: (key, on) => set((s) => ({ data: { ...s.data, switches: { ...s.data.switches, [key]: on } } })),
  importLinkraText: (text) => {
    const data = importLinkra(JSON.parse(text), get().data);
    set({ data });
    return data;
  },
}));

/** Loads planner.json, then saves it on every change (only after the load, so a slow load can't wipe it). */
let started = false;
export async function loadPlanner() {
  if (started) return;
  started = true;
  let saved: unknown;
  try {
    saved = await ipc.loadState<unknown>("planner");
  } catch {
    // Unreadable file: keep it on disk as it is. Without a successful load nothing is ever saved over it.
    toast("Couldn't read the planner file; planner changes won't be saved this session.", true);
    return;
  }
  usePlanner.setState({ data: normalizePlanner(saved), loaded: true });
  let last = JSON.stringify(usePlanner.getState().data);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failing = false;
  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    const json = JSON.stringify(usePlanner.getState().data);
    if (json === last) return;
    // `last` only moves once the write succeeded, so a failed write is retried.
    ipc.saveState("planner", JSON.parse(json)).then(
      () => {
        last = json;
        failing = false;
      },
      () => {
        if (!failing) toast("Couldn't save the planner; retrying. Keep the app open.", true);
        failing = true;
        timer ??= setTimeout(save, 5000);
      },
    );
  };
  // Typing in a note changes the store on every key: write at most once a moment, and when the window hides or closes.
  usePlanner.subscribe(() => {
    timer ??= setTimeout(save, 250);
  });
  window.addEventListener("beforeunload", save);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && save());
}

/** Call once the layout is hydrated: a thread that settles (or whose PR merges) is logged, and its roadmap card ships. */
export function watchSettled() {
  useLayout.subscribe((s, prev) => {
    if (s.panes === prev.panes) return;
    for (const id of settledIds(prev.panes, s.panes)) usePlanner.getState().update((d) => addActivity(d, "thread-settled", basename(s.panes[id].cwd) || "thread"));
    for (const id of newlySettled(prev.panes, s.panes)) usePlanner.getState().update((d) => shipCard(d, id));
  });
}
