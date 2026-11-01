/** A prompt link's contents: `aureliaspace://new?prompt=…[&cwd=…][&account=…]`. */
export interface PromptLink {
  prompt: string;
  cwd?: string;
  account?: string;
}

const MAX_PROMPT = 20_000;

/** Parses a prompt link, or returns null if it isn't one. Never runs anything. */
export function parsePromptLink(raw: string): PromptLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "aureliaspace:") return null;
  // "aureliaspace://new?…" puts the verb in the host; "aureliaspace:new?…" in the path.
  const verb = (url.host || url.pathname.replace(/^\/+/, "")).replace(/\/+$/, "").toLowerCase();
  if (verb !== "new" && verb !== "prompt") return null;
  const prompt = url.searchParams.get("prompt")?.trim();
  if (!prompt) return null;
  const cwd = url.searchParams.get("cwd")?.trim() || undefined;
  const account = url.searchParams.get("account")?.trim() || undefined;
  return {
    prompt: prompt.slice(0, MAX_PROMPT),
    ...(cwd && (cwd.startsWith("/") || cwd.startsWith("~")) ? { cwd } : {}),
    ...(account ? { account } : {}),
  };
}

/**
 * The link that reopens `prompt` as a draft: `aureliaspace://new?prompt=…`. Null when the text is empty or longer
 * than a link may carry. A folder or account is added only when asked for; opening such a link still asks first.
 */
export function buildPromptLink(prompt: string, opts: { cwd?: string; account?: string } = {}): string | null {
  const text = prompt.trim();
  if (!text || text.length > MAX_PROMPT) return null;
  const q = new URLSearchParams({ prompt: text });
  if (opts.cwd) q.set("cwd", opts.cwd);
  if (opts.account) q.set("account", opts.account);
  return `aureliaspace://new?${q.toString()}`;
}
