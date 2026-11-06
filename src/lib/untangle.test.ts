import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { searchSections } from "./settingsIndex.ts";
import {
  accountSessions,
  ADDITION_CLAUSE,
  diskOrUnavailable,
  focusArea,
  installAllowed,
  invocationMessage,
  parseUntangleCommand,
  routeUntangleInstall,
  statusLabel,
  untangleAvail,
  untanglePreview,
  untangleSendGate,
  type UntangleApi,
  type UntangleDisk,
} from "./untangle.ts";

const assetDir = join(dirname(fileURLToPath(import.meta.url)), "../../src-tauri/resources/untangle-codebase");
const skill = readFileSync(join(assetDir, "SKILL.md"), "utf8");
const license = readFileSync(join(assetDir, "LICENSE"), "utf8");
const notice = readFileSync(join(assetDir, "NOTICE"), "utf8");

const installed: UntangleDisk = {
  state: "installed",
  reason: "Installed and matches the bundled skill.",
  configDir: "/Users/a/.claude-work",
  skillDir: "/Users/a/.claude-work/skills/untangle-codebase",
};

test("the packaged skill and license are the full upstream text, adapted in place", () => {
  assert.ok(skill.length > 4000);
  assert.ok(license.length > 500);
  assert.match(skill, /disable-model-invocation: true/);
  assert.doesNotMatch(skill, /disable-model-invocation: false/);
  assert.match(skill, /Adapted from caldoai\/skills, MIT, Copyright \(c\) 2026 Maze/);
  assert.match(skill, /https:\/\/github\.com\/caldoai\/skills\/tree\/main\/skills\/untangle-codebase/);
  assert.match(skill, /\/untangle-codebase \[optional area\]/);
  assert.match(skill, /Never invoke it on your own/);
  assert.match(skill, /Remove comments that only restate the code\./);
  assert.match(skill, /Remove tests that wouldn't catch a real bug, and fix the ones that fail without one\./);
  assert.match(skill, /workaround om the codebase/);
  assert.match(skill, /\*\*Hidden links:\*\*/);
  assert.match(skill, /\*\*Needless links:\*\*/);
  assert.match(skill, /\*\*Surplus:\*\*/);
  assert.match(skill, /decision-log-example/);
  assert.match(skill, /Test this at the end\./);
  assert.equal(skill.split("$ARGUMENTS").length - 1, 1);
  assert.match(license, /Copyright \(c\) 2026 Maze/);
  assert.match(license, /Permission is hereby granted, free of charge, to any person obtaining a copy/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND/);
  assert.match(notice, /Adapted from caldoai\/skills, MIT, Copyright \(c\) 2026 Maze/);
  assert.match(notice, /https:\/\/github\.com\/caldoai\/skills\/tree\/main\/skills\/untangle-codebase/);
});

test("install is called only by account name, and never for the shared folder or a conflict", async () => {
  const calls: string[] = [];
  const api: UntangleApi = {
    async untangleStatus(account) {
      if (account === "claude") {
        return { state: "unavailable", reason: "The shared ~/.claude account is not an isolated Claude config. Install is unavailable, so this skill is not written there.", configDir: "/Users/a/.claude", skillDir: null };
      }
      if (account === "mine") {
        return { state: "conflict", reason: "left unchanged", configDir: "/Users/a/.claude-mine", skillDir: "/Users/a/.claude-mine/skills/untangle-codebase" };
      }
      return { state: "notInstalled", reason: "Not installed.", configDir: "/Users/a/.claude-work", skillDir: "/Users/a/.claude-work/skills/untangle-codebase" };
    },
    async untangleInstall(account) {
      calls.push(account);
      return { ...installed, configDir: "/Users/a/.claude-work", skillDir: "/Users/a/.claude-work/skills/untangle-codebase" };
    },
  };
  const blocked = await routeUntangleInstall(api, "claude");
  assert.equal(blocked.state, "unavailable");
  assert.equal(blocked.skillDir, null);
  const conflict = await routeUntangleInstall(api, "mine");
  assert.equal(conflict.state, "conflict");
  const placed = await routeUntangleInstall(api, "work");
  assert.deepEqual(calls, ["work"]);
  assert.equal(placed.skillDir, "/Users/a/.claude-work/skills/untangle-codebase");
  assert.ok(!placed.skillDir?.endsWith("/.claude/skills/untangle-codebase"));
  assert.equal(installAllowed("installed"), false);
  assert.equal(installAllowed("notInstalled"), true);
  assert.equal(installAllowed("outdated"), true);
});

test("a mock asset round-trip keeps the skill and license bytes", async () => {
  const api = {
    async untangleAsset() {
      return { skill, license, notice };
    },
  };
  const got = await api.untangleAsset();
  assert.equal(got.skill, skill);
  assert.equal(got.license, license);
  assert.equal(got.notice, notice);
  const preview = untanglePreview(got.skill, "src/lib", "both");
  assert.equal(preview.skill, skill);
  assert.equal(preview.message, "/untangle-codebase src/lib -- additions: refactor plus comments and tests");
  assert.equal(preview.message.includes("Hidden links"), false);
  assert.equal(preview.message.split("/untangle-codebase").length - 1, 1);
});

test("the message names one additions choice and does not delete tests unless that choice says so", () => {
  assert.equal(invocationMessage("api", "refactor"), `/untangle-codebase api -- ${ADDITION_CLAUSE.refactor}`);
  assert.equal(invocationMessage("", "refactor").includes("tests"), false);
  assert.equal(invocationMessage("src/lib", "comments"), "/untangle-codebase src/lib -- additions: refactor plus comments");
  assert.equal(invocationMessage("src/lib", "tests"), "/untangle-codebase src/lib -- additions: refactor plus tests");
  assert.equal(focusArea("src/lib -- additions: refactor plus tests"), "src/lib");
  assert.equal(invocationMessage("src/lib -- additions: refactor plus tests", "refactor"), "/untangle-codebase src/lib -- additions: refactor only");
  assert.equal(focusArea("a\nb\t c"), "a b c");
});

test("only a whole /untangle-codebase message opens the invocation", () => {
  assert.deepEqual(parseUntangleCommand("/untangle-codebase"), { area: "" });
  assert.deepEqual(parseUntangleCommand("  /untangle-codebase  src/lib  "), { area: "src/lib" });
  assert.equal(parseUntangleCommand("please /untangle-codebase"), null);
  assert.equal(parseUntangleCommand("/untangle"), null);
  assert.equal(parseUntangleCommand("/model opus"), null);
});

test("status distinguishes not installed, a session that must relaunch, and ready", () => {
  assert.equal(untangleAvail({ ...installed, state: "notInstalled", reason: "Not installed." }, []).kind, "notInstalled");
  assert.equal(untangleAvail({ ...installed, state: "unavailable", reason: "shared" }, [{ commands: [{ name: "untangle-codebase" }] }]).kind, "unavailable");
  assert.equal(untangleAvail(installed, []).kind, "ready");
  assert.match(untangleAvail(installed, []).reason, /Ready for new sessions/);
  assert.equal(untangleAvail(installed, [{ commands: [{ name: "untangle-codebase" }] }]).kind, "ready");
  assert.equal(untangleAvail(installed, [{ commands: [{ name: "review" }] }]).kind, "needsRestart");
  assert.equal(untangleAvail(installed, [{ commands: null }]).kind, "needsRestart");
  assert.match(untangleAvail(installed, [{ commands: [] }, { commands: null }]).reason, /2 open chats/);
  assert.equal(statusLabel("needsRestart"), "Installed, open sessions need a new launch");
  assert.equal(statusLabel("ready"), "Ready for new sessions");
  assert.equal(statusLabel("notInstalled"), "Not installed");
  assert.equal(diskOrUnavailable(null, null).state, "unavailable");
  assert.ok(diskOrUnavailable(null, null).reason.includes("~/.claude"));
});

test("open chats on the account are the sessions that count, and the send gate follows that session", () => {
  const panes = {
    p1: { account: "work", mode: "chat" as const },
    p2: { account: "work", mode: "terminal" as const },
    p3: { account: "work", provider: "opencode", mode: "chat" as const },
    p4: { account: "other", mode: "chat" as const },
    p5: { account: "work", launcher: true },
  };
  const chats = {
    p1: { status: "idle", commands: [{ name: "review" }] },
    p2: { status: "idle", commands: [{ name: "untangle-codebase" }] },
    p3: { status: "idle", commands: [{ name: "untangle-codebase" }] },
    p4: { status: "idle", commands: [] },
    p5: { status: "idle" },
  };
  const sessions = accountSessions("work", panes, chats);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].commands?.[0].name, "review");
  assert.equal(untangleAvail(installed, sessions).kind, "needsRestart");
  assert.deepEqual(untangleSendGate({ commands: [{ name: "untangle-codebase" }] }), { ok: true });
  const missing = untangleSendGate({ commands: [{ name: "review" }] });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.reason, /Nothing was sent/);
  const opencode = untangleSendGate({ provider: "opencode", commands: [{ name: "untangle-codebase" }] });
  assert.equal(opencode.ok, false);
  const unknown = untangleSendGate({ commands: null });
  assert.equal(unknown.ok, false);
});

test("settings search opens the accounts page for this skill", () => {
  assert.ok(searchSections("untangle").some((s) => s.id === "accounts"));
});
