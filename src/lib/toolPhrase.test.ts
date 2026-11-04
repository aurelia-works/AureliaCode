import { test } from "node:test";
import assert from "node:assert/strict";
import { liveToolLabel, pickBySeed, toolPhrase } from "./toolPhrase.ts";

const t = (name: string, input: Record<string, unknown> = {}) => ({ name, input });

test("commands and edits lead, files count once", () => {
  const tools = [t("Read", { file_path: "a" }), t("Bash"), t("Edit", { file_path: "a" }), t("Edit", { file_path: "a" }), t("Write", { file_path: "b" }), t("Bash")];
  assert.equal(toolPhrase(tools), "Ran 2 commands, edited 2 files and 1 more");
});

test("singulars and a lone kind", () => {
  assert.equal(toolPhrase([t("Bash")]), "Ran 1 command");
  assert.equal(toolPhrase([t("Grep"), t("Glob"), t("Read", { file_path: "x" })]), "Read 1 file, searched 2 times");
});

test("unknown tools count as more, or stand alone", () => {
  assert.equal(toolPhrase([t("Agent"), t("mcp__x__y"), t("TodoWrite")]), "Started 1 agent and 2 more");
  assert.equal(toolPhrase([t("mcp__x__y"), t("TodoWrite")]), "2 tools");
});

test("live labels name what the tool is working on", () => {
  assert.equal(liveToolLabel(t("Read", { file_path: "/Users/you/dev/web/src/components/Composer.tsx" }), "a"), "Reading Composer.tsx");
  assert.equal(liveToolLabel(t("Edit", { file_path: "src/a.ts" }), "a"), "Editing a.ts");
  assert.equal(liveToolLabel(t("Write", { file_path: "src/b.ts" }), "a"), "Writing b.ts");
  assert.equal(liveToolLabel(t("Grep", { pattern: "u001d" }), "a"), "Searching for u001d");
  assert.equal(liveToolLabel(t("Bash", { command: "npm test -- --watch", description: "Run the front-end tests" }), "a"), "Run the front-end tests");
  assert.equal(liveToolLabel(t("Bash", { command: "npm test -- --watch" }), "a"), "Running npm test");
  assert.equal(liveToolLabel(t("WebFetch", { url: "https://www.example.com/docs" }), "a"), "Reading example.com");
  assert.equal(liveToolLabel(t("Agent", { description: "Find the key tap" }), "a"), "Agent: Find the key tap");
  assert.equal(liveToolLabel(t("mcp__aurelia__aurelia_browser"), "a"), "Using aurelia browser");
  assert.equal(liveToolLabel(t("Mystery"), "a"), "Using Mystery");
});

test("a bare call's wording is varied but stable for its id", () => {
  const bare = new Set(["Running a command", "At the shell", "Running it"]);
  const seen = new Set<string>();
  for (const id of ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"]) {
    const label = liveToolLabel(t("Bash"), id);
    assert.ok(bare.has(label), label);
    assert.equal(liveToolLabel(t("Bash"), id), label);
    seen.add(label);
  }
  assert.ok(seen.size > 1, "one wording for every call");
  assert.equal(pickBySeed(["x"], "anything"), "x");
});

test("long targets are cut with an ellipsis", () => {
  const label = liveToolLabel(t("Grep", { pattern: "a".repeat(80) }), "a");
  assert.ok(label.length <= "Searching for ".length + 32 && label.endsWith("…"), label);
});
