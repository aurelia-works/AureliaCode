import assert from "node:assert/strict";
import { test } from "node:test";
import { contextFill } from "./contextFill.ts";

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
