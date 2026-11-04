import assert from "node:assert/strict";
import { test } from "node:test";
import { withoutTerminal } from "./paneKind.ts";

test("a Claude account pane opens as chat", () => {
  assert.equal(withoutTerminal({ id: "p", account: "claude-a", cwd: "~/x" }).mode, "chat");
});

test("a plain or non-Claude terminal pane falls back to the start screen", () => {
  const plain = withoutTerminal({ id: "p", cwd: "~/x" });
  assert.equal(plain.launcher, true);
  assert.equal(plain.mode, undefined);
  assert.equal(withoutTerminal({ id: "p", agent: "codex:oss" }).launcher, true);
  assert.equal(withoutTerminal({ id: "p", account: "claude-a", customAgent: "a1" }).launcher, true);
});

test("chat, launcher, browser and editor panes are left as they are", () => {
  for (const pane of [
    { id: "p", account: "claude-a", mode: "chat" as const },
    { id: "p", launcher: true },
    { id: "p", browser: { url: "" } },
    { id: "p", editor: { path: "/a.ts" } },
  ]) {
    assert.equal(withoutTerminal(pane as never), pane);
  }
});
