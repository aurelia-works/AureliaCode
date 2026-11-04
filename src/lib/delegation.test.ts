import { test } from "node:test";
import assert from "node:assert/strict";
import { delegationTool, parseDelegation } from "./delegation.ts";

const report = (body: string, footer: string) => `${body}\n\n---\n${footer}`;

test("delegation tools are found under any MCP server name", () => {
  assert.equal(delegationTool("mcp__aurelia__aurelia_delegate"), "delegate");
  assert.equal(delegationTool("mcp__aurelia__aurelia_delegation"), "delegation");
  assert.equal(delegationTool("mcp__aurelia__deepseek_agent"), "deepseek");
  assert.equal(delegationTool("mcp__aurelia__aurelia_browser"), null);
  assert.equal(delegationTool("Bash"), null);
});

test("a call that hasn't returned is running, with its task and provider", () => {
  const d = parseDelegation("mcp__aurelia__aurelia_delegate", { provider: "claude", task: "Find the bug", mode: "work" }, undefined)!;
  assert.deepEqual([d.state, d.who, d.mode, d.task], ["running", "Claude", "work", "Find the bug"]);
});

test("a finished report gives the answer, model, time, files and what was blocked", () => {
  const result = report(
    "add() subtracts; fixed in calc.py:2.",
    "DeepSeek agent · opencode-go/deepseek-v4.1-flash · write · 4 tool calls · 12.5s · session ses_abc\nChanged: calc.py, sub.py\nBlocked: shell git push; shell rm -rf x\nDelegation d3",
  );
  const d = parseDelegation("mcp__aurelia__aurelia_delegate", { provider: "opencode", task: "t" }, result)!;
  assert.equal(d.state, "done");
  assert.equal(d.report, "add() subtracts; fixed in calc.py:2.");
  assert.deepEqual([d.who, d.model, d.mode, d.tools, d.secs, d.session, d.id], ["DeepSeek", "opencode-go/deepseek-v4.1-flash", "work", 4, 12.5, "ses_abc", "d3"]);
  assert.deepEqual(d.changed, ["calc.py", "sub.py"]);
  assert.deepEqual(d.blocked, ["shell git push", "shell rm -rf x"]);
});

test("a failed run keeps why it stopped; an empty report is no report", () => {
  const d = parseDelegation("mcp__aurelia__deepseek_agent", { tasks: ["a", "b"] }, report("(The agent returned no report.)", "DeepSeek agent · m · read-only · 1 tool call · 600.0s\nStopped: it ran past the time limit\nopencode said:\nboom"), true)!;
  assert.deepEqual([d.state, d.tools, d.stopped, d.report, d.task], ["failed", 1, "it ran past the time limit", undefined, "a\nb"]);
});

test("a background start and a progress line are told apart from a report", () => {
  const started = parseDelegation("mcp__aurelia__aurelia_delegate", { provider: "grok", task: "t", wait: false }, 'Started d7: Grok agent on "t". Check it with aurelia_delegation')!;
  assert.deepEqual([started.state, started.id, started.who], ["background", "d7", "Grok"]);
  const status = parseDelegation("mcp__aurelia__aurelia_delegation", { action: "status", id: "d7" }, "d7 · Grok agent · default model · read · t · running 40s · 3 tool calls")!;
  assert.deepEqual([status.state, status.id], ["status", "d7"]);
  assert.match(status.report!, /running 40s/);
  assert.equal(parseDelegation("mcp__aurelia__aurelia_delegation", { action: "wait", id: "nope" }, "No delegated run nope in this chat.", true)!.state, "failed");
});

test("a cancel reply is the stopped run, without the cancel line in its report", () => {
  const d = parseDelegation("mcp__aurelia__aurelia_delegation", { action: "cancel", id: "d2" }, "Cancelled d2.\n\n" + report("(The agent returned no report.)", "DeepSeek agent · m · read-only · 0 tool calls · 5.1s\nStopped: cancelled.\nDelegation d2"))!;
  assert.deepEqual([d.state, d.report, d.stopped, d.id], ["failed", undefined, "cancelled.", "d2"]);
});
