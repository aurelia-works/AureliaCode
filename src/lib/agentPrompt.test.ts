import assert from "node:assert/strict";
import { test } from "node:test";
import { agentPrompt } from "./agentPrompt.ts";

test("a Claude Task call gives its agent, model and prompt", () => {
  const p = agentPrompt("Task", { description: "Find the bug", prompt: "Look in src/lib.\nReport file:line.", subagent_type: "scout", model: "haiku" });
  assert.deepEqual(p, { agent: "scout", model: "haiku", prompt: "Look in src/lib.\nReport file:line." });
});

test("Agent calls and OpenCode's lowercase task tool count too", () => {
  assert.equal(agentPrompt("Agent", { prompt: "do it" })?.prompt, "do it");
  assert.equal(agentPrompt("task", { prompt: "go", subagent_type: "general" })?.agent, "general");
});

test("other tools, and agent calls without a prompt yet, give nothing", () => {
  assert.equal(agentPrompt("Bash", { command: "ls", prompt: "x" }), null);
  assert.equal(agentPrompt("Task", { description: "streaming" }), null);
});

test("an encrypted prompt says the provider hid it", () => {
  const p = agentPrompt("Task", { description: "x", encrypted_content: "gAAAAB..." });
  assert.deepEqual(p, { agent: undefined, model: undefined, prompt: null });
});
