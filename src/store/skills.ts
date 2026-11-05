import { create } from "zustand";
import { expandPath } from "../lib/format";
import { ipc } from "../lib/ipc";
import { DEFAULT_SKILL_ROOTS, parseSkill, savedRoots, sortSkills, type Skill, type SkillRoot } from "../lib/skills";

interface SkillsState {
  roots: SkillRoot[];
  skills: Skill[];
  loading: boolean;
  error: string | null;
  load(roots?: SkillRoot[]): Promise<void>;
  refresh(): Promise<void>;
  /** Replaces the roots and persists them, then rescans. */
  setRoots(roots: SkillRoot[]): Promise<void>;
}

let loaded = false;
let canSave = true;
let scanSeq = 0;

/** The roots the user last chose, or the DeepSeek pack first. */
export const useSkills = create<SkillsState>((set, get) => ({
  roots: DEFAULT_SKILL_ROOTS,
  skills: [],
  loading: false,
  error: null,
  async load(roots) {
    const token = ++scanSeq;
    let next = roots?.length ? roots : get().roots;
    set({ loading: true, error: null });
    if (!loaded && !roots?.length) {
      try {
        const saved = await ipc.loadState<{ roots?: SkillRoot[] }>("skills");
        if (token !== scanSeq) return;
        next = savedRoots(saved);
        loaded = true;
        canSave = true;
      } catch {
        if (token !== scanSeq) return;
        // Keep loaded=false so Refresh retries; don't save over a file we couldn't read.
        canSave = false;
        set({ error: "Couldn't read skills.json; changes won't be saved until it is fixed." });
      }
    }
    set({ roots: next });
    try {
      const skills = await scanRoots(next);
      if (token !== scanSeq) return; // a newer scan owns the state
      set({ skills: sortSkills(skills), loading: false });
    } catch (e) {
      if (token !== scanSeq) return;
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  async refresh() {
    await get().load();
  },
  async setRoots(roots) {
    set({ roots });
    const saved = await saveRoots(roots);
    await get().load(roots);
    if (!saved) set({ error: "Couldn't save skills.json; this change will be lost on restart." });
  },
}));

async function saveRoots(roots: SkillRoot[]): Promise<boolean> {
  if (!canSave) return false;
  try {
    await ipc.saveState("skills", { roots });
    return true;
  } catch {
    return false;
  }
}

/** Runs `fn` over `items` with at most `limit` in flight: 30 SKILL.md reads is fine, 300 is not. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function scanRoots(roots: SkillRoot[]): Promise<Skill[]> {
  const out: Skill[] = [];
  for (const root of roots) {
    const dir = expandPath(root.path);
    let entries: Awaited<ReturnType<typeof ipc.listDir>>;
    try {
      entries = await ipc.listDir(dir);
    } catch {
      continue; // a root that isn't installed is normal
    }
    const dirs = entries.filter((e) => e.dir && !e.name.startsWith("."));
    const found = await mapLimit(dirs, 6, async (e) => {
      try {
        const { text } = await ipc.readTextFile(`${e.path}/SKILL.md`);
        return parseSkill(text, e.path, root.path);
      } catch {
        return null; // not a skill folder
      }
    });
    for (const s of found) if (s) out.push(s);
  }
  // A skill installed under two roots appears once, with the first root winning.
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)));
}
