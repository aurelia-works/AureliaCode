import assert from "node:assert/strict";
import { test } from "node:test";
import { recentSteps } from "./recentSteps.ts";

const tool = (id: string, name: string, input: Record<string, unknown>, isError = false) => ({ kind: "tool" as const, id, name, input, isError });

test("the last few tool steps read as past-tense lines, newest last", () => {
  const items = [
    { kind: "user" as const, id: "u", text: "fix it" },
    tool("1", "Read", { file_path: "/repo/src/keys.ts" }),
    tool("2", "Grep", { pattern: "onKeyDown" }),
    { kind: "text" as const, id: "t", text: "found it" },
    tool("3", "Edit", { file_path: "/repo/src/keys.ts" }),
    tool("4", "Bash", { command: "npm test -- keys\nmore" }, true),
  ];
  assert.deepEqual(recentSteps(items, 3), [
    { id: "2", text: "Searched for onKeyDown", failed: false },
    { id: "3", text: "Edited keys.ts", failed: false },
    { id: "4", text: "Ran npm test -- keys", failed: true },
  ]);
});

test("unknown tools keep their name; nothing yet is an empty list", () => {
  assert.deepEqual(recentSteps([tool("1", "mcp__x__y", {})]), [{ id: "1", text: "Used mcp__x__y", failed: false }]);
  assert.deepEqual(recentSteps([]), []);
});
