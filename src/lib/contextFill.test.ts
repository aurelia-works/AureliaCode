import assert from "node:assert/strict";
import { test } from "node:test";
import { contextFill, freshness } from "./contextFill.ts";

// Real numbers, 2026-11-02, session 080ca23f on claude-opus-5-5 with autoCompactWindow 350000:
// the transcript's last request was 196,556 tokens and `/context` answered 197,603 of 350,000.
test("the bell and the composer read the same number: the CLI's window, not a guess from the model name", () => {
  const f = contextFill({ transcript: { tokens: 196_556, at: 2000 }, chat: { totalTokens: 197_603, maxTokens: 350_000, at: 1000 } });
  assert.equal(f?.window, 350_000);
  assert.equal(f?.tokens, 196_556);
  assert.equal(Math.round(f!.pct), 56);
});

test("whichever count is newer wins, so a running turn moves it and a compaction brings it down", () => {
  const chat = { totalTokens: 40_000, maxTokens: 350_000, at: 5000 };
  assert.equal(contextFill({ transcript: { tokens: 300_000, at: 4000 }, chat })?.tokens, 40_000);
  assert.equal(contextFill({ transcript: { tokens: 41_000, at: 6000 }, chat })?.tokens, 41_000);
});

test("a terminal pane reads its status line", () => {
  const f = contextFill({ live: { contextTokens: 100_000, contextWindow: 200_000 }, transcript: { tokens: 90_000, at: 1 } });
  assert.deepEqual([f?.tokens, f?.window, f?.pct], [100_000, 200_000, 50]);
});

test("with only a turn's usage it uses that turn's window", () => {
  assert.equal(contextFill({ last: { contextTokens: 28_317, contextWindow: 1_000_000 } })?.window, 1_000_000);
});

test("no window from the CLI means no number, never a guess", () => {
  assert.equal(contextFill({ transcript: { tokens: 196_556, at: 1 } }), null);
  assert.equal(contextFill({}), null);
});

test("over-full reads as 100", () => {
  assert.equal(contextFill({ chat: { totalTokens: 400_000, maxTokens: 350_000, at: 1 } })?.pct, 100);
});

test("says whether the number is the CLI's count or an estimate, and when it was read", () => {
  const chat = { totalTokens: 40_000, maxTokens: 350_000, at: 5000 };
  assert.deepEqual(
    [contextFill({ chat })?.source, contextFill({ chat })?.at],
    ["measured", 5000],
  );
  const newer = contextFill({ chat, transcript: { tokens: 41_000, at: 6000 } });
  assert.deepEqual([newer?.source, newer?.at], ["estimate", 6000]);
  assert.equal(contextFill({ live: { contextTokens: 1000, contextWindow: 200_000, at: 7 } })?.source, "measured");
  assert.equal(contextFill({ last: { contextTokens: 1000, contextWindow: 200_000 } })?.source, "estimate");
  assert.equal(contextFill({ last: { contextTokens: 1000, contextWindow: 200_000 } })?.at, undefined);
});

test("freshness says the source and a person's idea of the age", () => {
  assert.equal(freshness({ source: "measured", at: 10_000 }, 12_000), "Measured · updated just now");
  assert.equal(freshness({ source: "estimate", at: 10_000 }, 22_000), "Estimate · updated 12s ago");
  assert.equal(freshness({ source: "measured", at: 0 }, 5_000_000), "Measured");
  assert.equal(freshness({ source: "estimate", at: 1 }, 1 + 3 * 60_000), "Estimate · updated 3m ago");
  assert.equal(freshness({ source: "measured", at: 1 }, 1 + 2 * 3_600_000), "Measured · updated 2h ago");
});
