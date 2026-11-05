import { test } from "node:test";
import assert from "node:assert/strict";
import { crewRuns, sortCrew } from "./crew.ts";
import type { ChatItem } from "./chatModel.ts";

const tool = (id: string, name: string, input: Record<string, unknown>, result?: string, at = 1000): ChatItem => ({
  kind: "tool",
  id,
  toolId: `t-${id}`,
  name,
  input,
  partial: "",
  result,
  steps: 0,
  at,
});

const REPORT = `DeepSeek found the missing guard.

---

DeepSeek agent · deepseek-v4.1-flash · read-only · 4 tool calls · 12.5s
Changed: src/a.ts, src/b.ts
Delegation d7`;

test("a waiting delegation shows as a running worker with its task and provider", () => {
  const runs = crewRuns([tool("c1", "mcp__aurelia__aurelia_delegate", { provider: "opencode", model: "deepseek-v4.1-flash", task: "Find the missing guard" })]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].state, "running");
  assert.equal(runs[0].who, "OpenCode");
  assert.equal(runs[0].title, "Find the missing guard");
  assert.equal(runs[0].model, "deepseek-v4.1-flash");
  assert.equal(runs[0].requestKey, "c1");
});

test("a background start, its status check and its report are one worker", () => {
  const items: ChatItem[] = [
    tool("c1", "mcp__aurelia__aurelia_delegate", { provider: "opencode", task: "Audit retries" }, 'Started d7: DeepSeek agent on "Audit retries"', 1000),
    tool("c2", "mcp__aurelia__aurelia_delegation", { action: "status", id: "d7" }, "d7 · DeepSeek agent · deepseek-v4.1-flash · read · running 8s · 2 tool calls", 2000),
    tool("c3", "mcp__aurelia__aurelia_delegation", { action: "wait", id: "d7" }, REPORT, 3000),
  ];
  const runs = crewRuns(items);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, "d7");
  assert.equal(runs[0].state, "done");
  assert.equal(runs[0].tools, 4);
  assert.deepEqual(runs[0].changed, ["src/a.ts", "src/b.ts"]);
  assert.match(runs[0].report ?? "", /missing guard/);
  assert.equal(runs[0].log.length, 3, "start, status and report are kept as progress");
  assert.match(runs[0].log[1].text, /running/);
});

test("parallel delegations stay separate", () => {
  const runs = crewRuns([
    tool("c1", "mcp__aurelia__aurelia_delegate", { provider: "opencode", task: "One" }, 'Started d1: DeepSeek agent on "One"', 1000),
    tool("c2", "mcp__aurelia__aurelia_delegate", { provider: "claude", task: "Two" }, 'Started d2: Claude agent on "Two"', 1100),
  ]);
  assert.deepEqual(runs.map((r) => r.id).sort(), ["d1", "d2"]);
});

test("a later status cannot downgrade a finished run", () => {
  const runs = crewRuns([
    tool("c1", "mcp__aurelia__aurelia_delegate", { provider: "opencode", task: "Check" }, 'Started d1: DeepSeek agent on "Check"', 1000),
    tool("c2", "mcp__aurelia__aurelia_delegation", { action: "wait", id: "d1" }, REPORT, 2000),
    tool("c3", "mcp__aurelia__aurelia_delegation", { action: "status", id: "d1" }, "d1 · still running", 3000),
  ]);
  assert.equal(runs[0].state, "done");
});

test("a cancelled run says it stopped", () => {
  const runs = crewRuns([
    tool("c1", "mcp__aurelia__aurelia_delegate", { provider: "opencode", task: "Long job" }, 'Started d1: DeepSeek agent on "Long job"', 1000),
    tool("c2", "mcp__aurelia__aurelia_delegation", { action: "cancel", id: "d1" }, "Cancelled d1.\n\nStopped before finishing.\n\n---\nDeepSeek agent · m · read-only · 1 tool call · 2.0s\nStopped: cancelled.", 2000),
  ]);
  assert.equal(runs[0].state, "failed");
  assert.equal(runs[0].stopped, "cancelled.");
});

test("a status for a run this chat did not start adds no worker", () => {
  const runs = crewRuns([tool("c1", "mcp__aurelia__aurelia_delegation", { action: "status", id: "d9" }, "no such run")]);
  assert.equal(runs.length, 0);
});

test("active workers sort above finished ones", () => {
  const runs = crewRuns([
    tool("c1", "mcp__aurelia__aurelia_delegate", { provider: "opencode", task: "Done one" }, REPORT, 1000),
    tool("c2", "mcp__aurelia__aurelia_delegate", { provider: "opencode", task: "Still going" }, undefined, 2000),
  ]);
  assert.equal(sortCrew(runs)[0].title, "Still going");
});

test("a status line's state comes from its state field, not from words in the task title or progress note", () => {
  const start = tool("c1", "mcp__aurelia__aurelia_delegate", { provider: "opencode", task: "Find why login failed" }, 'Started d7: DeepSeek agent on "Find why login failed"', 1000);
  const status = (id: string, text: string, at: number) => tool(id, "mcp__aurelia__aurelia_delegation", { action: "status", id: "d7" }, text, at);
  const titled = crewRuns([start, status("c2", "d7 · DeepSeek agent · m · read · Find why login failed · running 5s · 2 tool calls", 2000)]);
  assert.equal(titled[0].state, "running", "'failed' in the title is not the run failing");
  const noted = crewRuns([start, status("c2", "d7 · DeepSeek agent · m · read · Look · running 5s · 2 tool calls · now: done reading src", 2000)]);
  assert.equal(noted[0].state, "running", "'done' in the progress note is not the run finishing");
  const waited = crewRuns([start, status("c2", "Still running after 30s: d7 · DeepSeek agent · m · read · Fix failed test · running 30s · 9 tool calls", 2000)]);
  assert.equal(waited[0].state, "running");
  const finished = crewRuns([start, status("c2", "d7 · DeepSeek agent · m · read · Find why login failed · done", 2000)]);
  assert.equal(finished[0].state, "done");
  const failed = crewRuns([start, status("c2", "d7 · DeepSeek agent · m · read · Find the bug · failed", 2000)]);
  assert.equal(failed[0].state, "failed");
});

test("a status with no text adds nothing to the progress log", () => {
  const items: ChatItem[] = [
    tool("c1", "mcp__aurelia__aurelia_delegate", { provider: "opencode", task: "Audit" }, 'Started d7: DeepSeek agent on "Audit"', 1000),
    tool("c2", "mcp__aurelia__aurelia_delegation", { action: "status", id: "d7" }, "d7 · x · running 5s · 1 tool calls", 2000),
    tool("c3", "mcp__aurelia__aurelia_delegation", { action: "status", id: "d7" }, "d7 · x · running 9s · 2 tool calls", 3000),
    tool("c4", "mcp__aurelia__aurelia_delegation", { action: "status", id: "d7" }, "", 4000),
  ];
  assert.deepEqual(crewRuns(items)[0].log.map((e) => e.at), [1000, 2000, 3000]);
});

test("the same transcript array is read once", () => {
  const items: ChatItem[] = [tool("c1", "mcp__aurelia__aurelia_delegate", { provider: "opencode", task: "Audit" })];
  assert.equal(crewRuns(items), crewRuns(items));
});
