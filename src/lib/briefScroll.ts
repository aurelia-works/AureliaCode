/** Where a scroll key puts a thread card. `null` means the key is not a card scroll. */
export function briefScrollDelta(key: string, shiftKey: boolean, clientHeight: number): number | "start" | "end" | null {
  const page = Math.max(1, clientHeight);
  const line = Math.max(16, Math.round(clientHeight / 4));
  if (key === "Home") return "start";
  if (key === "End") return "end";
  if (key === "PageDown") return page;
  if (key === "PageUp") return -page;
  if (key === "ArrowDown") return line;
  if (key === "ArrowUp") return -line;
  if (key === " " || key === "Spacebar") return shiftKey ? -page : page;
  return null;
}

/** The next scrollTop, clamped to the card. */
export function nextBriefScrollTop(current: number, delta: number | "start" | "end", scrollHeight: number, clientHeight: number): number {
  const max = Math.max(0, scrollHeight - clientHeight);
  const next = delta === "start" ? 0 : delta === "end" ? max : current + delta;
  return Math.min(max, Math.max(0, next));
}
