import { test } from "node:test";
import assert from "node:assert/strict";
import { chatCan, freshChat, launcherToChat } from "./chatStart.ts";

test("a start pane becomes a chat in its own folder, else the workspace, on the folder's account", () => {
  assert.deepEqual(launcherToChat({ cwd: "/p" }, { workspace: "/w", preferred: "work", firstAccount: "claude" }), { launcher: undefined, mode: "chat", cwd: "/p", account: "work" });
  assert.deepEqual(launcherToChat({}, { workspace: "/w", firstAccount: "claude" }), { launcher: undefined, mode: "chat", cwd: "/w", account: "claude" });
  // An account the pane was opened with wins over the folder's usual one.
  assert.equal(launcherToChat({ account: "b" }, { preferred: "work" }).account, "b");
  assert.equal(launcherToChat({}, {}).cwd, undefined);
});

test("only an unused chat counts as fresh", () => {
  assert.equal(freshChat({}, 0), true);
  assert.equal(freshChat({ chatUsed: true }, 0), false);
  assert.equal(freshChat({ claudeSession: "s" }, 0), false);
  assert.equal(freshChat({}, 1), false);
  assert.equal(freshChat(undefined, 0), false);
});

test("an OpenCode chat offers none of Claude Code's extras: edit a message, fork, permission modes", () => {
  assert.deepEqual(chatCan({ provider: "opencode" }), { branch: false, fork: false, mode: false });
  assert.deepEqual(chatCan({}), { branch: true, fork: true, mode: true });
  assert.deepEqual(chatCan(undefined), { branch: true, fork: true, mode: true });
});
