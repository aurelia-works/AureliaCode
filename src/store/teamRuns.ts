import { create } from "zustand";
import type { TeamPlan } from "../lib/teamRun";
import { ipc } from "../lib/ipc";
import { uid, useLayout } from "./layout";
import { toast } from "./ui";

/**
 * Team runs: one record per "Run team" click, kept across restarts so the agent view can
 * show what a team was asked to do after its panes are gone. The record is a log, not a
 * scheduler: the panes do the work, and tools/control update the status here.
 */

export type TeamRunStatus = "running" | "done" | "blocked" | "failed";

export interface TeamRun {
  id: string;
  teamId: string;
  task: string;
  plan: TeamPlan;
  /** Lead first, then workers, in pane order. */
  paneIds: string[];
  status: TeamRunStatus;
  /** Merged worker verdict (lib/teamRun.ts summarizeRun), or the last status note. */
  summary: string;
  createdAt: number;
}

interface TeamRunsState {
  runs: TeamRun[];
  start(run: Omit<TeamRun, "id" | "createdAt">): string;
  update(id: string, patch: Partial<Pick<TeamRun, "paneIds" | "status" | "summary">>): void;
  /** Records the merged verdict and settles the run. */
  finish(id: string, status: TeamRunStatus, summary: string): void;
  remove(id: string): void;
}

export const useTeamRuns = create<TeamRunsState>((set, get) => ({
  runs: [],
  start(run) {
    const id = uid("run");
    const record: TeamRun = { ...run, id, createdAt: Date.now() };
    set((s) => ({ runs: [record, ...s.runs] }));
    return id;
  },
  update: (id, patch) => set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
  finish: (id, status, summary) => get().update(id, { status, summary }),
  remove: (id) => set((s) => ({ runs: s.runs.filter((r) => r.id !== id) })),
}));

export const teamRunById = (id: string) => useTeamRuns.getState().runs.find((r) => r.id === id);

const STATUSES: TeamRunStatus[] = ["running", "done", "blocked", "failed"];

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let canSave = false;

/** Writes now, for the window's beforeunload handler. */
export function flushTeamRuns() {
  clearTimeout(saveTimer);
  if (!canSave) return Promise.resolve();
  return ipc.saveState("teamruns", { runs: useTeamRuns.getState().runs }).catch(() => {});
}

/** Loads teamruns.json, then saves on every change. Old files are simply a list of runs. */
export async function loadTeamRuns() {
  let saved: { runs?: TeamRun[] } | TeamRun[] | null;
  try {
    saved = await ipc.loadState<{ runs?: TeamRun[] } | TeamRun[]>("teamruns");
  } catch {
    // A read error must not be replaced by an empty file on the next change.
    toast("Couldn't read teamruns.json; runs won't be saved this session", true);
    return;
  }
  const list = Array.isArray(saved) ? saved : saved?.runs;
  if (saved != null && !Array.isArray(list)) {
    toast("teamruns.json has an unexpected shape; it was not changed", true);
    return;
  }
  if (Array.isArray(list)) {
    const runs = list.filter(
      (r): r is TeamRun =>
        !!r && typeof r.id === "string" && typeof r.teamId === "string" && typeof r.task === "string" && !!r.plan && Array.isArray(r.paneIds),
    );
    if (runs.length !== list.length) {
      toast("teamruns.json has records this version doesn't understand; it was not changed", true);
      return;
    }
    canSave = true;
    useTeamRuns.setState({
      runs: runs.map((r) => ({
        ...r,
        status: STATUSES.includes(r.status) ? r.status : "done",
        summary: typeof r.summary === "string" ? r.summary : "",
        createdAt: Number(r.createdAt) || Date.now(),
      })),
    });
  } else {
    canSave = true;
  }
  useTeamRuns.subscribe((s, prev) => {
    if (s.runs === prev.runs) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (canSave) ipc.saveState("teamruns", { runs: useTeamRuns.getState().runs }).catch(() => {});
    }, 400);
  });
}


/**
 * A run is a log, so it must not stay "running" forever. When every pane is gone, close it
 * as blocked with a clear note. Idle panes are not enough: a lead can sit on a permission
 * prompt or a sequential team can pause between turns. The lead can still call
 * aurelia_team_finish first and write the real summary.
 */
export function startTeamRunWatch() {
  const check = () => {
    const panes = useLayout.getState().panes;
    for (const run of useTeamRuns.getState().runs) {
      if (run.status !== "running") continue;
      if (run.paneIds.length > 0 && run.paneIds.every((id) => !panes[id])) {
        useTeamRuns.getState().finish(run.id, "blocked", "Every pane closed before the lead reported; no merged report.");
      }
    }
  };
  useLayout.subscribe((s, prev) => s.panes !== prev.panes && check());
  check();
}
