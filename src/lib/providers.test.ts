import { test } from "node:test";
import assert from "node:assert/strict";
import { chatProviderOptions, chatUnavailable, currentProblem, signInLine, sortProviders, type ProviderStatus } from "./providers.ts";

const p = (over: Partial<ProviderStatus>): ProviderStatus => ({ id: "x", provider: "x", label: "X", installed: true, models: [], caps: [], ...over });
const claude = (account: string, over: Partial<ProviderStatus> = {}) =>
  p({ id: `claude:${account}`, provider: "claude", label: `Claude · ${account}`, signedIn: true, auth: "Claude.ai account, Pro plan", caps: ["chat", "resume"], ...over });

test("a provider is greyed with the first reason that applies", () => {
  assert.equal(chatUnavailable(p({ installed: false, signedIn: false })), "Not installed");
  assert.equal(chatUnavailable(claude("work", { signedIn: false })), "Not signed in");
  assert.match(chatUnavailable(p({ id: "opencode", signedIn: true, caps: ["resume"] })) ?? "", /terminal/);
  assert.equal(chatUnavailable(claude("work")), null);
  // Unknown sign-in doesn't block: the CLI says so itself when it runs.
  assert.equal(chatUnavailable(claude("work", { signedIn: null })), null);
});

test("the sign-in line says yes, no or unknown, and how", () => {
  assert.equal(signInLine(claude("a")), "Signed in · Claude.ai account, Pro plan");
  assert.equal(signInLine(p({ signedIn: false })), "Not signed in");
  assert.equal(signInLine(p({ signedIn: null, auth: "API key" })), "Sign-in unknown · API key");
  assert.equal(signInLine(p({ installed: false })), "Not installed");
});

test("Claude accounts come first, then installed CLIs, then missing ones", () => {
  const list = [p({ id: "cursor", installed: false }), p({ id: "opencode" }), claude("work"), p({ id: "grok" }), claude("main")];
  assert.deepEqual(sortProviders(list).map((x) => x.id), ["claude:work", "claude:main", "opencode", "grok", "cursor"]);
});

test("the composer's list: this account, another account, and greyed CLIs with why", () => {
  const opts = chatProviderOptions([p({ id: "opencode", label: "OpenCode", caps: ["resume"] }), claude("main"), claude("work", { signedIn: false }), claude("b")], "main");
  assert.deepEqual(opts.map((o) => [o.value, o.disabled ?? ""]), [
    ["claude:main", ""],
    ["claude:work", "Not signed in"],
    ["claude:b", ""],
    ["opencode", "No chat here yet; opens as a terminal from the launcher (⌘E)"],
  ]);
  assert.equal(opts[0].desc, "Signed in · Claude.ai account, Pro plan");
  assert.equal(opts[2].desc, "Starts a new chat on this account");
});

test("a chat whose own account is signed out says so instead of falling back", () => {
  assert.equal(currentProblem([claude("main", { signedIn: false })], "main"), "Not signed in");
  assert.equal(currentProblem([claude("main")], "main"), null);
  assert.equal(currentProblem(undefined, "main"), null);
});
