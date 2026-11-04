/**
 * How full a thread's context is: the one number the composer ring, the rail, the bell and the
 * HUD all show. Pure (no imports) so `node --test` can run it; store/metrics.ts feeds it.
 *
 * The window always comes from the CLI. It isn't a fact about the model: `autoCompactWindow`
 * in settings.json moves it (Opus 5.5 at 350k here), so it is never guessed from a name.
 */

export interface ContextSources {
  /** The status line (terminal panes only: headless Claude Code never runs it). */
  live?: { contextTokens?: number; contextWindow?: number };
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
}

export function contextFill(x: ContextSources): ContextFill | null {
  const window = x.chat?.maxTokens || x.live?.contextWindow || x.last?.contextWindow || 0;
  if (!window) return null;
  const { chat, live, last, transcript } = x;
  const tokens = !chat && live?.contextTokens !== undefined ? live.contextTokens : transcript && (!chat || transcript.at > chat.at) ? transcript.tokens : (chat?.totalTokens ?? last?.contextTokens);
  if (!tokens) return null;
  return { tokens, window, pct: Math.min(100, (tokens / window) * 100) };
}
