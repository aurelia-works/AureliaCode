/**
 * The nightly review's state and scheduler (lib/nightly.ts has the rules). Each open repo gets one folder reviewed a
 * night, in turn; the last result per repo is kept for the morning card on the Board. Saved to nightly.json.
 */
import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { isDue, nextFolder, overnight, type Overnight } from "../lib/nightly";
import { useLayout } from "./layout";
import { useUi } from "./ui";
import { readSaved } from "../lib/savedState";
import { warnUnreadable } from "./notifications";

export interface RepoNight extends Overnight {
  folder: string;
  at: number;
  error?: string;
}

interface NightlyState {
  lastRun?: number;
  running: boolean;
  /** By repo folder (a thread's cwd): the folder reviewed last and what was found. */
  byRepo: Record<string, RepoNight>;
  /** Findings you've dismissed, by `repo|file:line|text`. */
  dismissed: string[];
}

export const useNightly = create<NightlyState>(() => ({ running: false, byRepo: {}, dismissed: [] }));

const save = () => {
  const { lastRun, byRepo, dismissed } = useNightly.getState();
  if (canSave) void ipc.saveState("nightly", { lastRun, byRepo, dismissed }).catch(() => {});
};

/** At most this many repos a night, so one night can't run a dozen reviews. */
const MAX_REPOS = 3;

/** Open threads' folders; runNightly resolves them to repo roots and keeps MAX_REPOS distinct ones. */
function openDirs(): string[] {
  return [...new Set(Object.values(useLayout.getState().panes).filter((p) => p.cwd && !p.browser && !p.editor).map((p) => p.cwd!))];
}

/** Runs tonight's review now: one folder per open repo, one repo at a time. */
export async function runNightly() {
  if (useNightly.getState().running) return;
  useNightly.setState({ running: true });
  const models = useUi.getState().prefs.councilModels.split(",").map((m) => m.trim()).filter(Boolean);
  let ran = false;
  try {
    const plans = new Map<string, string[]>();
    for (const dir of openDirs()) {
      if (plans.size >= MAX_REPOS) break;
      const plan = await ipc.auditFolders(dir).catch(() => null);
      if (plan && !plans.has(plan.root)) plans.set(plan.root, plan.folders);
    }
    for (const [repo, folders] of plans) {
      const prev = useNightly.getState().byRepo[repo];
      const folder = nextFolder(folders, prev?.folder);
      if (folder === undefined) continue;
      ran = true;
      let night: RepoNight;
      try {
        const seats = await ipc.councilAudit(repo, folder, models);
        night = { folder, at: Date.now(), ...overnight(seats) };
        // Every reviewer failed: say so instead of showing an empty, clean-looking night.
        if (!night.reviewers) night.error = seats.find((s) => s.failed)?.text.split("\n")[0].slice(0, 200) || "no reviewer finished";
      } catch (e) {
        night = { folder, at: Date.now(), reviewers: 0, findings: [], error: String(e) };
      }
      useNightly.setState((s) => ({ byRepo: { ...s.byRepo, [repo]: night } }));
    }
  } finally {
    // A night with no repo open doesn't count, so it catches up once one is.
    useNightly.setState((s) => ({ running: false, lastRun: ran ? Date.now() : s.lastRun }));
    save();
  }
}

export function dismissFinding(key: string) {
  useNightly.setState((s) => ({ dismissed: [...s.dismissed, key].slice(-500) }));
  save();
}

function tick() {
  const prefs = useUi.getState().prefs;
  if (prefs.nightlyReview && isDue(Date.now(), useNightly.getState().lastRun, prefs.nightlyHour)) void runNightly();
}

/** False when nightly.json couldn't be read: findings and dismissals there aren't replaced. */
let canSave = true;

export async function startNightly() {
  const r = await readSaved(() => ipc.loadState<Partial<NightlyState>>("nightly"));
  if (!r.ok) {
    canSave = false;
    warnUnreadable("nightly.json", r.error);
  }
  const saved = r.ok ? r.value : null;
  if (saved) useNightly.setState({ lastRun: saved.lastRun, byRepo: saved.byRepo ?? {}, dismissed: saved.dismissed ?? [] });
  setInterval(tick, 10 * 60_000);
  setTimeout(tick, 60_000);
}
