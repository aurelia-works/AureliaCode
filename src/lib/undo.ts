/** A short-lived stack of undoable thread actions (close, settle, snooze). Pure: the clock is passed in. */

export interface UndoEntry {
  id: number;
  /** "Settled 2 threads": what was done. */
  label: string;
  /** Epoch ms the entry stops being offered. */
  until: number;
  run(): void;
}

let seq = 0;

export function makeEntry(label: string, run: () => void, now: number, ms: number): UndoEntry {
  return { id: ++seq, label, until: now + ms, run };
}

/** Entries still within their window, oldest first. */
export const liveEntries = (list: UndoEntry[], now: number) => list.filter((e) => e.until > now);

/** Adds an entry; expired ones drop out. */
export const pushEntry = (list: UndoEntry[], entry: UndoEntry, now: number): UndoEntry[] => [...liveEntries(list, now), entry];

/** The entry ⌘Z would undo: the newest live one. */
export const latestEntry = (list: UndoEntry[], now: number): UndoEntry | undefined => liveEntries(list, now).at(-1);

/** The list without the entry that was just run. */
export const withoutEntry = (list: UndoEntry[], id: number) => list.filter((e) => e.id !== id);

/** "Settled 1 thread" / "Closed 3 threads". */
export const undoLabel = (verb: string, count: number) => `${verb} ${count} thread${count === 1 ? "" : "s"}`;

/**
 * The values a patch is about to overwrite, so undo can put them back. A key that was unset comes back as
 * `undefined`, which updatePane merges as "unset".
 */
export function previous<T extends object>(meta: T, patch: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(patch) as (keyof T)[]) out[k] = meta[k];
  return out;
}
