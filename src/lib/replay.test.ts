import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReplay, sanitizeLine, turnEvents } from "./replay.ts";

const lines = [
  { type: "system", subtype: "init", model: "claude-sonnet-5-5" },
  { type: "user", message: { role: "user", content: "Fix the bug" } },
  { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" } }] } },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
  { type: "assistant", message: { id: "m2", content: [{ type: "text", text: "Fixed." }] } },
  { type: "result", subtype: "success", is_error: false, duration_ms: 1200, total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } },
  { type: "user", message: { role: "user", content: "Now add a test" } },
  { type: "assistant", message: { id: "m3", content: [{ type: "text", text: "Added." }] } },
];
const jsonl = lines.map((l) => JSON.stringify(l)).join("\n") + "\n\nnot json\n";

test("a recording splits into one turn per prompt, without the prompt lines", () => {
  const turns = parseReplay(jsonl);
  assert.equal(turns.length, 2);
  assert.deepEqual(turns[0].prompt, "Fix the bug");
  assert.deepEqual(turns[0].lines.map((l) => l.type), ["system", "assistant", "user", "assistant"]);
  assert.deepEqual(turns[1].lines.map((l) => l.type), ["assistant"]);
});

test("a turn plays as working, its lines, then a turn end with the recorded usage", () => {
  const [first, second] = parseReplay(jsonl);
  const ev = turnEvents(first);
  assert.deepEqual(ev[0], { type: "status", status: "working" });
  assert.equal(ev.filter((e) => e.type === "raw").length, 4);
  assert.deepEqual(ev.at(-2), {
    type: "turnEnd",
    outcome: "completed",
    error: null,
    durationMs: 1200,
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 0, costUsd: 0.01 },
  });
  assert.deepEqual(ev.at(-1), { type: "status", status: "idle" });
  // A transcript has no result line: the turn still ends, with no usage.
  assert.deepEqual(turnEvents(second).at(-2), { type: "turnEnd", outcome: "completed", error: null, durationMs: null, usage: null });
});

test("an error result ends the turn as failed", () => {
  const [t] = parseReplay([{ type: "user", message: { content: "x" } }, { type: "result", subtype: "error_during_execution", is_error: true, result: "boom" }].map((l) => JSON.stringify(l)).join("\n"));
  assert.deepEqual(turnEvents(t).at(-2), { type: "turnEnd", outcome: "failed", error: "boom", durationMs: null, usage: null });
});

test("the recorder keeps only chat lines and hides the home folder", () => {
  assert.equal(sanitizeLine({ type: "file-history-snapshot" }, "/Users/jah"), null);
  assert.equal(sanitizeLine({ type: "summary", summary: "x" }, "/Users/jah"), null);
  const kept = sanitizeLine({ type: "assistant", cwd: "/Users/jah/dev/app", message: { content: [{ type: "text", text: "see /Users/jah/dev/app/a.ts" }] } }, "/Users/jah");
  assert.equal(JSON.stringify(kept).includes("/Users/jah"), false);
  assert.match(JSON.stringify(kept), /~\/dev\/app\/a\.ts/);
});
