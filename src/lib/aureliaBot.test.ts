import { test } from "node:test";
import assert from "node:assert/strict";
import { CONV_TAIL, MAX_TEXT, WATCH_MS, botProviders, chatSummary, chatVisual, convTail, refuse, watching, type SourceChat } from "./aureliaBot.ts";

const chat = (over: Partial<SourceChat> = {}): SourceChat => ({
  status: "working",
  transcript: { items: [] },
  approvals: [],
  queued: [],
  costUsd: 0.42,
  ...over,
});

test("convTail keeps the newest lines, drops thinking and completed turns, clips long text", () => {
  const items = [
    { kind: "user" as const, id: "u1", text: "Fix the flaky test" },
    { kind: "thinking" as const, id: "th", text: "secret reasoning" },
    { kind: "tool" as const, id: "t1", name: "Bash", input: { command: "npm test -- focus" }, isError: true },
    { kind: "text" as const, id: "x1", text: "y".repeat(MAX_TEXT + 50) },
    { kind: "turn" as const, id: "k1", outcome: "completed" },
    { kind: "turn" as const, id: "k2", outcome: "failed", error: "rate limited" },
  ];
  const out = convTail(items);
  assert.deepEqual(out.map((i) => i.id), ["u1", "t1", "x1", "k2"]);
  assert.deepEqual(out[1], { id: "t1", kind: "tool", name: "Bash", text: "npm test -- focus", failed: true });
  assert.equal(out[2].text.length, MAX_TEXT);
  assert.equal(out[3].text, "failed: rate limited");
  const many = Array.from({ length: CONV_TAIL + 5 }, (_, n) => ({ kind: "user" as const, id: `u${n}`, text: `m${n}` }));
  assert.equal(convTail(many)[0].id, "u5");
});

test("chatSummary gives the last reply, open approvals, queue and the running goal", () => {
  const s = chat({
    model: "claude-sonnet-5-5",
    transcript: {
      items: [
        { kind: "text", id: "a", text: "first" },
        { kind: "text", id: "b", text: "Two suspects left:\n the Karabiner rule\n and Voice." },
        { kind: "tool", id: "c", name: "Read", input: { file_path: "a.ts" } },
      ],
    },
    approvals: [{ id: "r1", tool: "Bash", input: { command: "log show --last 5m" } }],
    queued: [{}],
  });
  const got = chatSummary(s, { text: "Settings nav passes", rounds: 1, maxRounds: 6, last: { met: false, code: 1, tail: "3 of 11 failing" } }, "Claude · work");
  assert.deepEqual(got, {
    status: "working",
    model: "claude-sonnet-5-5",
    provider: "Claude · work",
    last: "Two suspects left: the Karabiner rule and Voice.",
    approvals: [{ id: "r1", tool: "Bash", what: "log show --last 5m" }],
    queued: 1,
    goal: { text: "Settings nav passes", round: 2, max: 6, last: "3 of 11 failing" },
    costUsd: 0.42,
  });
  assert.equal(chatSummary(s, { text: "g", rounds: 6, maxRounds: 6, ended: { met: true } }).goal, undefined, "an ended goal isn't shown");
});

test("watching drops panes the phone stopped asking about", () => {
  const w = new Map([
    ["p1", 1000],
    ["p2", 1000 + WATCH_MS],
  ]);
  assert.deepEqual(watching(w, 1000 + WATCH_MS + 1), ["p2"]);
  assert.equal(w.has("p1"), false);
});

test("refuse: answers only open requests, spawns only in offered folders on usable providers", () => {
  const have = {
    chats: { p1: chat({ approvals: [{ id: "r1", tool: "Bash", input: {} }] }) },
    folders: ["/Users/jah/dev/web"],
    providers: botProviders([
      { id: "claude:work", provider: "claude", label: "Claude · work", models: [], why: null },
      { id: "grok", provider: "grok", label: "Grok", models: [], why: "Not signed in" },
    ]),
  };
  assert.equal(refuse({ kind: "approve", pane: "p1", id: "r1", allow: true }, have), null);
  assert.equal(refuse({ kind: "approve", pane: "p1", id: "old", allow: true }, have), "request already answered");
  assert.equal(refuse({ kind: "say", pane: "p9", text: "hi" }, have), "not a chat");
  assert.equal(refuse({ kind: "say", pane: "p1", text: "  " }, have), "empty message");
  const spawn = { kind: "spawn" as const, provider: "claude:work", model: "sonnet", cwd: "/Users/jah/dev/web", prompt: "Add a test", nonce: "n" };
  assert.equal(refuse(spawn, have), null);
  assert.equal(refuse({ ...spawn, cwd: "/etc" }, have), "unknown folder");
  assert.equal(refuse({ ...spawn, provider: "grok" }, have), "Not signed in");
  assert.equal(refuse({ ...spawn, provider: "nope" }, have), "unknown provider");
  assert.equal(refuse({ ...spawn, model: "gpt" }, have), "unknown model");
  assert.equal(refuse({ ...spawn, prompt: "" }, have), "empty task");
});

test("botProviders: Claude gets its picks, others their own models after Default", () => {
  const got = botProviders([
    { id: "claude:a", provider: "claude", label: "Claude · a", models: ["x"], why: null },
    { id: "opencode", provider: "opencode", label: "OpenCode", models: ["anthropic/claude-sonnet-5-5"], why: null },
  ]);
  assert.deepEqual(got[0].models.map((m) => m.value), ["default", "auto", "opus", "sonnet", "haiku"]);
  assert.deepEqual(got[1].models, [{ value: "default", label: "Default" }, { value: "anthropic/claude-sonnet-5-5", label: "claude-sonnet-5-5" }]);
});

test("chatVisual: a chat with no agent session still shows its state, not 'shell'", () => {
  assert.equal(chatVisual("waiting"), "needs_input");
  assert.equal(chatVisual("working"), "working");
  assert.equal(chatVisual("starting"), "starting");
  assert.equal(chatVisual("idle"), "idle");
  assert.equal(chatVisual("exited"), "idle");
});
