import { test } from "node:test";
import assert from "node:assert/strict";
import { burning, fullCard, handoffAdvice } from "./advice.ts";

const base = { contextTokens: 0, contextWindow: 200_000, cacheCold: false, inputPricePerMTok: 4 };

test("nothing to say about a small or warm session", () => {
  assert.equal(handoffAdvice({ ...base, contextTokens: 50_000 }), null);
  assert.equal(handoffAdvice({ ...base, contextTokens: 50_000, cacheCold: true }), null, "cold but small");
  assert.equal(handoffAdvice({ ...base, contextTokens: 120_000 }), null, "big but warm");
  assert.equal(handoffAdvice({ ...base, contextWindow: 0, contextTokens: 120_000, cacheCold: true }), null, "unknown window");
});

test("a big cold cache is priced", () => {
  const a = handoffAdvice({ ...base, contextTokens: 150_000, cacheCold: true });
  assert.equal(a?.reason, "cold");
  assert.equal(a?.title, "Cache went cold on 150k tokens");
  // 150k × 1.25 × $4/MTok = $0.75
  assert.match(a!.body, /about \$0\.75, 13× a warm turn/);
});

test("a nearly full window wins over the cache", () => {
  const a = handoffAdvice({ ...base, contextTokens: 170_000, cacheCold: true });
  assert.equal(a?.reason, "full");
  assert.equal(a?.title, "Context 85% full");
  assert.equal(handoffAdvice({ ...base, contextWindow: 1_000_000, contextTokens: 170_000 }), null, "same tokens in a 1M window");
});

test("the full card appears once at 80, follows the real number, and goes when the fact does", () => {
  assert.equal(fullCard(79.9, false), "none");
  assert.equal(fullCard(80, false), "show");
  assert.equal(fullCard(85, true), "update");
  assert.equal(fullCard(72, true), "update");
  assert.equal(fullCard(56, true), "clear");
  assert.equal(fullCard(56, false), "none");
});

test("burning fast needs a sustained rate, not one cold-cache rewrite", () => {
  // Resuming a 197k context on a cold cache: one request, nothing else.
  assert.equal(burning(false, 197_000, 1), false);
  assert.equal(burning(false, 197_000, 3), true);
  assert.equal(burning(true, 120_000, 3), true);
  assert.equal(burning(true, 90_000, 3), false);
});
