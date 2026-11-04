/**
 * How full a thread's context is: the one number the composer ring, the rail, the bell and the
 * HUD all show. Pure (no imports) so `node --test` can run it; store/metrics.ts feeds it.
 *
 * The window always comes from the CLI. It isn't a fact about the model: `autoCompactWindow`
 * in settings.json moves it (Opus 5.5 at 350k here), so it is never guessed from a name.
 */

export interface ContextSources {
  /** The status line (terminal panes only: headless Claude Code never runs it). */
  live?: { contextTokens?: number; contextWindow?: number; at?: number };
  /** The chat's `/context` answer, and when it came. */
  chat?: { totalTokens: number; maxTokens: number; at: number };
  /** The chat's last turn, when `/context` isn't available. */
  last?: { contextTokens?: number | null; contextWindow?: number | null };
  /** The transcript's newest request and its time: moves during a turn. */
  transcript?: { tokens: number; at: number };
}

export interface ContextFill {
  tokens: number;
  window: number;
  /** tokens as a share of window, 0–100, unrounded. */
  pct: number;
  /** "measured": the CLI's own count (`/context`, status line). "estimate": from API usage (newest request, last turn). */
  source: "measured" | "estimate";
  /** When that number was read (epoch ms), if known. */
  at?: number;
}

export function contextFill(x: ContextSources): ContextFill | null {
  const window = x.chat?.maxTokens || x.live?.contextWindow || x.last?.contextWindow || 0;
  if (!window) return null;
  const { chat, live, last, transcript } = x;
  const pick = (tokens: number | null | undefined, source: ContextFill["source"], at?: number): ContextFill | null =>
    tokens ? { tokens, window, pct: Math.min(100, (tokens / window) * 100), source, at } : null;
  if (!chat && live?.contextTokens !== undefined) return pick(live.contextTokens, "measured", live.at);
  if (transcript && (!chat || transcript.at > chat.at)) return pick(transcript.tokens, "estimate", transcript.at);
  return chat ? pick(chat.totalTokens, "measured", chat.at) : pick(last?.contextTokens, "estimate");
}

/** "Measured · updated 12s ago": where the ring's number came from and how old it is. */
export function freshness(fill: Pick<ContextFill, "source" | "at">, now: number): string {
  const what = fill.source === "measured" ? "Measured" : "Estimate";
  if (!fill.at) return what;
  const s = Math.max(0, Math.round((now - fill.at) / 1000));
  const age = s < 5 ? "just now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
  return `${what} · updated ${age}`;
}
