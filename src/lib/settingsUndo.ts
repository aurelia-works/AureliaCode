/** ⌘Z in Settings: every row applies at once, so each change is one step back. */

export type UndoKind = "config" | "prefs";

export interface Change {
  kind: UndoKind;
  before: unknown;
  after: unknown;
  at: number;
  /** The top-level fields it touched; typing into the same field merges into one step. */
  key: string;
}

/** Edits to the same field closer together than this are one step (typing a word). */
const MERGE_MS = 1000;
const LIMIT = 50;

export function changedKeys(before: object, after: object): string[] {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
}

export class UndoStack {
  private steps: Change[] = [];

  get size(): number {
    return this.steps.length;
  }

  push(kind: UndoKind, before: object, after: object, at: number): void {
    const key = changedKeys(before, after).join(",");
    if (!key) return;
    const last = this.steps[this.steps.length - 1];
    if (last && last.kind === kind && last.key === key && at - last.at < MERGE_MS) {
      last.after = after;
      last.at = at;
      return;
    }
    this.steps.push({ kind, before, after, at, key });
    if (this.steps.length > LIMIT) this.steps.shift();
  }

  undo(): Change | undefined {
    return this.steps.pop();
  }

  clear(): void {
    this.steps = [];
  }
}
