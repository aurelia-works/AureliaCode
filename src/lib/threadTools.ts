/** Small pure helpers for phase-5 thread features: follow-up mode, palette filter, PR references, retitling. */

export type FollowUp = "queue" | "steer";

/**
 * What Enter does with a message. Idle: just send. Busy: the saved mode, or the opposite for one message (⌘Enter).
 * Steer interrupts the running turn and sends the message as the next one; queue waits for the turn to end.
 */
export function followUpAction(busy: boolean, mode: FollowUp, opposite: boolean): "send" | "queue" | "steer" {
  if (!busy) return "send";
  return (mode === "steer") !== opposite ? "steer" : "queue";
}

/** A leading ">" in the palette means "actions only"; the rest is the search text. */
export function paletteQuery(q: string): { actionsOnly: boolean; text: string } {
  const t = q.trimStart();
  return t.startsWith(">") ? { actionsOnly: true, text: t.slice(1).trim() } : { actionsOnly: false, text: q.trim() };
}

/** What "Copy PR number" puts on the clipboard. */
export const prNumberRef = (n: number) => `#${n}`;

/**
 * A short title from a thread's own messages: the latest message with some substance, first line, markers and code
 * fences dropped, at most 60 characters (cut at a word). undefined when nothing fits.
 */
export function retitle(items: { kind: string; text?: string }[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== "user" || !it.text) continue;
    const line = it.text
      .split("\n")
      .map((l) => l.replace(/^\s*(?:[-*>#]+|\d+[.)])\s*/, "").replace(/`{1,3}/g, "").replace(/\s+/g, " ").trim())
      .find((l) => l.length >= 8 && !l.startsWith("/"));
    if (!line) continue;
    if (line.length <= 60) return line;
    const cut = line.slice(0, 60);
    const sp = cut.lastIndexOf(" ");
    return (sp > 30 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, "") + "…";
  }
  return undefined;
}
