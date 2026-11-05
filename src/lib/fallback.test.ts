import assert from "node:assert/strict";
import { test } from "node:test";
import { fallbackLabel, parseFallback, usableFallback, writeFallback } from "./fallback.ts";

test("a fallback names a provider, and an account for Claude, plus a model", () => {
  assert.deepEqual(parseFallback("claude:work:sonnet"), { provider: "claude", account: "work", model: "sonnet" });
  assert.deepEqual(parseFallback("opencode:openrouter/qwen3-coder"), { provider: "opencode", model: "openrouter/qwen3-coder" });
  assert.equal(parseFallback(""), null);
  assert.equal(parseFallback("claude:work"), null);
  assert.equal(parseFallback("grok:x"), null);
});

test("it round-trips and reads as words", () => {
  assert.equal(writeFallback({ provider: "claude", account: "work", model: "sonnet" }), "claude:work:sonnet");
  assert.equal(writeFallback({ provider: "opencode", model: "openrouter/qwen3-coder" }), "opencode:openrouter/qwen3-coder");
  assert.equal(fallbackLabel(parseFallback("claude:work:sonnet")), "work · sonnet");
  assert.equal(fallbackLabel(parseFallback("opencode:openrouter/qwen3-coder")), "OpenCode · qwen3-coder");
  assert.equal(fallbackLabel(null), "None");
});

test("the fallback is skipped when it is the account that just hit its limit", () => {
  const f = parseFallback("claude:work:sonnet");
  assert.equal(usableFallback(f, "work"), null);
  assert.deepEqual(usableFallback(f, "personal"), f);
  const oc = parseFallback("opencode:x/y");
  assert.deepEqual(usableFallback(oc, "work"), oc);
});
