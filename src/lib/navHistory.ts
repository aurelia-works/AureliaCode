/** Back and forward between the threads you focused, like a browser. Pure; the store feeds it focus changes. */

export interface NavHistory {
  stack: string[];
  /** Index of the current entry in `stack`; -1 when empty. */
  at: number;
}

export const NAV_CAP = 50;
export const emptyNav = (): NavHistory => ({ stack: [], at: -1 });

/** Focus moved to `id` by the user: it becomes the newest entry and anything "forward" is dropped. */
export function visit(h: NavHistory, id: string): NavHistory {
  if (h.stack[h.at] === id) return h;
  const stack = [...h.stack.slice(0, h.at + 1), id].slice(-NAV_CAP);
  return { stack, at: stack.length - 1 };
}

/** One step back (-1) or forward (+1) to an entry that still exists; entries for closed threads are skipped. */
export function step(h: NavHistory, dir: -1 | 1, exists: (id: string) => boolean): { h: NavHistory; id: string | null } {
  for (let i = h.at + dir; i >= 0 && i < h.stack.length; i += dir) {
    if (exists(h.stack[i])) return { h: { ...h, at: i }, id: h.stack[i] };
  }
  return { h, id: null };
}

/** Drops entries for threads that no longer exist, keeping the current position on the same entry when it survives. */
export function prune(h: NavHistory, exists: (id: string) => boolean): NavHistory {
  const cur = h.stack[h.at];
  const stack = h.stack.filter(exists);
  const at = cur !== undefined && stack.includes(cur) ? stack.lastIndexOf(cur) : stack.length - 1;
  return { stack, at };
}
