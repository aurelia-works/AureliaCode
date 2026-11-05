import { test } from "node:test";
import assert from "node:assert/strict";
import { chatCan, freshChat, launcherToChat, missingHistory } from "./chatStart.ts";

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
  assert.equal(freshChat({ claudeSession: "s" }, 0), true, "a session id from spawning is not a sent message");
  assert.equal(freshChat({}, 1), false);
  assert.equal(freshChat(undefined, 0), false);
});

test("an OpenCode chat offers none of Claude Code's extras: edit a message, fork, permission modes", () => {
  assert.deepEqual(chatCan({ provider: "opencode" }), { branch: false, fork: false, mode: false });
  assert.deepEqual(chatCan({}), { branch: true, fork: true, mode: true });
  assert.deepEqual(chatCan(undefined), { branch: true, fork: true, mode: true });
});

test("a missing transcript drops the session; another read error keeps it; a used chat stays used", () => {
  const gone = "/Users/x/.claude/projects/-p/abc.jsonl: No such file or directory (os error 2)";
  assert.deepEqual(missingHistory(gone, false), { clearSession: true });
  assert.deepEqual(missingHistory(gone, true), { clearSession: true, notice: "The earlier conversation couldn't be found, so this is a new chat" });
  const other = "unknown account 'work'";
  assert.equal(missingHistory(other, true).clearSession, false, "a renamed account must not lose the conversation");
  assert.match(missingHistory(other, true).notice ?? "", /unknown account 'work'/);
  assert.deepEqual(missingHistory(other, false), { clearSession: true }, "an unused chat has nothing to lose");
});
