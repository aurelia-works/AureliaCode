/**
 * When to suggest handing a Claude session off to a fresh one, and what to say. Pure (no
 * imports) so `node --test` can run it; lib/handoffAdvisor.ts feeds it live numbers.
 *
 * Prices are relative to an uncached input token: a cache write costs 1.25×, a cache
 * read 0.1×. A turn on a cold cache re-writes the whole context, about 12.5× what the same
 * context costs warm, every time the cache cools again.
 */

const WRITE = 1.25;
const READ = 0.1;
/** Below this, a cold cache costs too little to interrupt anyone. */
export const COLD_ADVICE_TOKENS = 60_000;
/** Claude Code compacts near the top of the window, losing detail. */
export const FULL_ADVICE_PCT = 80;
/** A full-context card goes once the context drops below this (compacted, handed off, cleared). */
export const FULL_CLEAR_PCT = 70;
/** Sustained tokens/min that counts as burning fast, and what it must fall under to stop. */
const BURN_RATE = 150_000;
const BURN_COOL = BURN_RATE * 0.7;
/** One cold-cache rewrite is a big number but not a rate. */
const BURN_MIN_REQUESTS = 3;

export interface AdviceInput {
  contextTokens: number;
  contextWindow: number;
  cacheCold: boolean;
  /** $ per million uncached input tokens for the pane's model. */
  inputPricePerMTok: number;
}

export interface Advice {
  reason: "full" | "cold";
  title: string;
  body: string;
}

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString("en-US"));
const usd = (n: number) => (n < 0.01 ? "under $0.01" : `$${n.toFixed(2)}`);

/** What to do with a thread's one context card. */
export function fullCard(pct: number, shown: boolean): "show" | "update" | "clear" | "none" {
  if (shown) return pct < FULL_CLEAR_PCT ? "clear" : "update";
  return pct >= FULL_ADVICE_PCT ? "show" : "none";
}

export const FULL_BODY = "Claude will compact soon and lose detail. A handoff starts a fresh session that reads this one's transcript.";

/** Whether a thread is burning fast, given whether it already was. */
export function burning(was: boolean, tokensPerMin: number, requests: number): boolean {
  if (was) return tokensPerMin > BURN_COOL;
  return requests >= BURN_MIN_REQUESTS && tokensPerMin > BURN_RATE;
}

export function handoffAdvice(x: AdviceInput): Advice | null {
  if (!x.contextTokens || !x.contextWindow) return null;
  const pct = (x.contextTokens / x.contextWindow) * 100;
  if (pct >= FULL_ADVICE_PCT) {
    return {
      reason: "full",
      title: `Context ${Math.round(pct)}% full`,
      body: FULL_BODY,
    };
  }
  if (x.cacheCold && x.contextTokens >= COLD_ADVICE_TOKENS) {
    const cold = (x.contextTokens * WRITE * x.inputPricePerMTok) / 1e6;
    const ratio = Math.round(WRITE / READ);
    return {
      reason: "cold",
      title: `Cache went cold on ${k(x.contextTokens)} tokens`,
      body: `Your next message re-writes all of it (about ${usd(cold)}, ${ratio}× a warm turn). A handoff starts fresh instead.`,
    };
  }
  return null;
}
