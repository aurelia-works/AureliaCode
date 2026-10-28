import { create } from "zustand";
import { logFocus, type RunningFocus } from "../lib/plannerHabits";
import { usePlanner } from "./planner";
import { toast } from "./ui";

interface FocusStore {
  running: RunningFocus | null;
  start(projectId: string | null): void;
  /** Ends the session (early or at zero) and logs it. */
  stop(): void;
}

/** The running timer lives in memory only; a finished or stopped session is saved into the planner. */
export const useFocus = create<FocusStore>((set, get) => ({
  running: null,
  start: (projectId) => set({ running: { startedAt: Date.now(), minutes: usePlanner.getState().data.settings.focusMinutes, projectId } }),
  stop: () => {
    const f = get().running;
    if (!f) return;
    set({ running: null });
    const before = usePlanner.getState().data.focusSessions.length;
    usePlanner.getState().update((s) => logFocus(s, f, Date.now()));
    if (usePlanner.getState().data.focusSessions.length > before) toast("Focus session logged");
  },
}));
