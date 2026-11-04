// What each agent CLI can do on this Mac (src-tauri/src/providers.rs), and what the pickers
// make of it: unavailable ones stay listed, greyed, with the reason. Pure, for `node --test`.

export interface ProviderStatus {
  /** "claude:<account>" for Claude, else the provider id. */
  id: string;
  provider: string;
  label: string;
  installed: boolean;
  path?: string | null;
  version?: string | null;
  /** null when the CLI has no way to tell. */
  signedIn?: boolean | null;
  auth?: string | null;
  email?: string | null;
  models: string[];
  defaultModel?: string | null;
  caps: string[];
  error?: string | null;
}

export const CAP_LABELS: Record<string, string> = {
  chat: "Chat here",
  resume: "Resume",
  interrupt: "Interrupt",
  steer: "Steer",
  effort: "Effort",
  images: "Images",
  files: "Files",
  mcp: "MCP",
};

/** Why a provider can't run a chat here, or null when it can. */
export function chatUnavailable(p: ProviderStatus): string | null {
  if (!p.installed) return "Not installed";
  if (p.signedIn === false) return "Not signed in";
  if (!p.caps.includes("chat")) return "No chat here yet; opens as a terminal from the launcher (⌘E)";
  return null;
}

/** "Signed in · Claude.ai account, Pro plan", "Not signed in", "Sign-in unknown · API key". */
export function signInLine(p: ProviderStatus): string {
  if (!p.installed) return "Not installed";
  const how = p.auth ? ` · ${p.auth}` : "";
  if (p.signedIn === true) return `Signed in${how}`;
  if (p.signedIn === false) return `Not signed in${how}`;
  return `Sign-in unknown${how}`;
}

/** Claude accounts first, then the rest installed, then not installed; each group in list order. */
export function sortProviders(list: ProviderStatus[]): ProviderStatus[] {
  const rank = (p: ProviderStatus) => (p.provider === "claude" ? 0 : p.installed ? 1 : 2);
  return list.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
}

export interface ProviderOption {
  value: string;
  label: string;
  desc: string;
  /** Set when it can't be picked: the reason. */
  disabled?: string;
}

/** The picker value of a chat: its provider ("opencode"), or "claude:<account>" for Claude. */
export function chatProviderId(account: string | undefined, provider?: string): string {
  return provider ?? `claude:${account}`;
}

/**
 * The composer's provider list for a chat on `account` (or `provider`, when it isn't Claude).
 * Another one starts a new chat there (a conversation can't move between them); the ones that
 * can't chat here are greyed with why.
 */
export function chatProviderOptions(list: ProviderStatus[], account: string | undefined, provider?: string): ProviderOption[] {
  return sortProviders(list).map((p) => {
    const why = chatUnavailable(p);
    const current = p.id === chatProviderId(account, provider);
    return {
      value: p.id,
      label: p.label,
      desc: why ?? (current ? signInLine(p) : p.provider === "claude" ? "Starts a new chat on this account" : `Starts a new ${p.label} chat`),
      ...(why && { disabled: why }),
    };
  });
}

/** The current chat's provider when discovery says it can't run: shown on the picker, never hidden. */
export function currentProblem(list: ProviderStatus[] | undefined, account: string | undefined, provider?: string): string | null {
  const p = list?.find((x) => x.id === chatProviderId(account, provider));
  return p ? chatUnavailable(p) : null;
}

/** True when a Claude account in the config isn't in the loaded list yet (added since it loaded). */
export function missingAccounts(list: ProviderStatus[] | undefined, accounts: string[]): boolean {
  return !!list && accounts.some((a) => !list.some((p) => p.id === `claude:${a}`));
}
