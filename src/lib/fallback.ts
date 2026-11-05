/**
 * The fallback model for a thread whose account hits its usage limit. It can be another Claude
 * account (the conversation moves with it) or another provider such as OpenCode (a new thread
 * in the same folder, seeded with the recent conversation). Stored as one string in prefs:
 * "claude:<account>:<model>" or "opencode:<provider/model>".
 */
export type Fallback = { provider: "claude"; account: string; model: string } | { provider: "opencode"; model: string };

export function parseFallback(s: string | undefined): Fallback | null {
  if (!s) return null;
  const i = s.indexOf(":");
  const provider = s.slice(0, i);
  const rest = s.slice(i + 1);
  if (provider === "opencode" && rest) return { provider, model: rest };
  if (provider === "claude") {
    const j = rest.indexOf(":");
    if (j > 0 && rest.slice(j + 1)) return { provider, account: rest.slice(0, j), model: rest.slice(j + 1) };
  }
  return null;
}

export function writeFallback(f: Fallback): string {
  return f.provider === "claude" ? `claude:${f.account}:${f.model}` : `opencode:${f.model}`;
}

export function fallbackLabel(f: Fallback | null): string {
  if (!f) return "None";
  return f.provider === "claude" ? `${f.account} · ${f.model}` : `OpenCode · ${f.model.slice(f.model.indexOf("/") + 1)}`;
}

/** The fallback, unless it is the very account that just ran out. */
export function usableFallback(f: Fallback | null, limitedAccount: string): Fallback | null {
  if (!f) return null;
  return f.provider === "claude" && f.account === limitedAccount ? null : f;
}
