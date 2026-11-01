/** Composer drafts set aside with ⌘S. Newest last; capped; whitespace-only drafts are ignored. */

export const STASH_CAP = 10;

export function stashDraft(list: string[], text: string): string[] {
  const t = text.trim();
  return t ? [...list, text].slice(-STASH_CAP) : list;
}

/** The newest stashed draft comes back; null when there is none. */
export function unstash(list: string[]): { list: string[]; text: string | null } {
  return list.length ? { list: list.slice(0, -1), text: list[list.length - 1] } : { list, text: null };
}

/**
 * ⌘S in a composer: a draft is stashed (and the box clears); an empty box brings the newest stash back.
 * `text` is what to put in the box afterwards.
 */
export function toggleStash(list: string[], current: string): { list: string[]; text: string; did: "stashed" | "restored" | "nothing" } {
  if (current.trim()) return { list: stashDraft(list, current), text: "", did: "stashed" };
  const back = unstash(list);
  return back.text === null ? { list, text: current, did: "nothing" } : { list: back.list, text: back.text, did: "restored" };
}
