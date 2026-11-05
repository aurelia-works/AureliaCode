import { test } from "node:test";
import assert from "node:assert/strict";
import { inboxItems, type InboxInput } from "./inbox.ts";

const empty = (): InboxInput => ({ chats: [], routines: [], nightly: { running: false, byRepo: {} }, babysits: [], teams: [] });
const DELEGATE = "mcp__aurelia__aurelia_delegate";
const STATUS = "mcp__aurelia__aurelia_delegation";
const footer = (who: string) => `\n\n---\n${who} agent · deepseek-v4 · read-only · 3 tool calls · 12.5s`;

test("nothing running gives an empty inbox", () => {
  assert.deepEqual(inboxItems(empty()), []);
});

test("a background delegation and its later check are one row, with the latest state and report", () => {
  const input = empty();
  input.chats = [
    {
      paneId: "p1",
      tools: [
        { id: "t1", name: DELEGATE, input: { task: "Find the flaky test\nmore detail", background: true }, result: 'Started d3: DeepSeek agent on "Find the flaky test"', at: 1000 },
        { id: "t2", name: STATUS, input: { id: "d3" }, result: `It's NavTest: a race on focus.${footer("DeepSeek")}`, at: 5000 },
      ],
    },
  ];
  const items = inboxItems(input);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "delegation");
  assert.equal(items[0].state, "done");
  assert.equal(items[0].title, "DeepSeek: Find the flaky test");
  assert.equal(items[0].result, "It's NavTest: a race on focus.");
  assert.equal(items[0].paneId, "p1");
  assert.equal(items[0].at, 5000);
});

test("a delegation still waiting on its call is running; one that errored is failed", () => {
  const input = empty();
  input.chats = [
    {
      paneId: "p1",
      tools: [
        { id: "t1", name: DELEGATE, input: { task: "Read the logs", provider: "opencode" }, at: 1000 },
        { id: "t2", name: DELEGATE, input: { task: "Fix it" }, result: "No API key for DeepSeek", isError: true, at: 2000 },
        { id: "t3", name: "Read", input: { file_path: "/x" }, result: "…", at: 3000 },
      ],
    },
  ];
  const items = inboxItems(input);
  assert.deepEqual(items.map((i) => [i.title, i.state]), [["OpenCode: Read the logs", "running"], ["Agent: Fix it", "failed"]]);
  assert.equal(items[1].result, "No API key for DeepSeek");
});

test("routines take their state from the pane they opened", () => {
  const input = empty();
  input.routines = [
    { id: "r1", name: "Morning triage", at: 100, paneId: "p9", status: "working" },
    { id: "r2", name: "", at: 200, paneId: "p8", status: "needs_input" },
    { id: "r3", name: "Old one", at: 50, status: undefined },
  ];
  const items = inboxItems(input);
  assert.deepEqual(items.map((i) => [i.title, i.state]), [["Routine: untitled", "waiting"], ["Routine: Morning triage", "running"], ["Routine: Old one", "done"]]);
  assert.equal(items[0].result, "Needs your answer");
  assert.equal(items[2].paneId, undefined, "a closed pane has nothing to open");
});

test("nightly review: a row per repo with what it found, plus one while it runs", () => {
  const input = empty();
  input.nightly = {
    running: true,
    byRepo: {
      "/r/app": { folder: "src/store", at: 300, findings: [{}, {}] },
      "/r/mod": { folder: "src", at: 200, findings: [], error: "council failed" },
      "/r/web": { folder: "lib", at: 100, findings: [] },
    },
  };
  const items = inboxItems(input);
  assert.deepEqual(items.map((i) => [i.title, i.state, i.result]), [
    ["Nightly review", "running", "Reading one folder of each open repo"],
    ["Nightly review: mod", "failed", "council failed"],
    ["Nightly review: app", "done", "2 findings in src/store"],
    ["Nightly review: web", "done", "Nothing found in lib"],
  ]);
});

test("PR babysits: on is running, merged is done, stopped is waiting on you", () => {
  const input = empty();
  input.babysits = [
    { paneId: "a", title: "Fix login", on: true, wakes: 2, pr: { number: 12, state: "OPEN", checks: "pending" }, at: 30 },
    { paneId: "b", title: "Docs", on: false, wakes: 1, pr: { number: 9, state: "MERGED", checks: "pass" }, at: 20 },
    { paneId: "c", title: "Big refactor", on: false, wakes: 6, pr: { number: 7, state: "OPEN", checks: "fail" }, at: 10 },
    { paneId: "d", title: "Never on", on: false, wakes: 0, pr: null, at: 5 },
  ];
  const items = inboxItems(input);
  assert.deepEqual(items.map((i) => [i.title, i.state, i.result]), [
    ["PR #7: Big refactor", "waiting", "Stopped after 6 wakes; checks failing"],
    ["PR #12: Fix login", "running", "Woken 2 times; checks pending"],
    ["PR #9: Docs", "done", "Merged"],
  ]);
});

test("team runs keep their status and merged summary", () => {
  const input = empty();
  input.teams = [
    { id: "t1", task: "Port the parser", status: "blocked", summary: "Lead needs the schema", createdAt: 10, paneIds: ["l", "w"] },
    { id: "t2", task: "Write docs", status: "done", summary: "3 pages", createdAt: 20, paneIds: [] },
  ];
  const items = inboxItems(input);
  assert.deepEqual(items.map((i) => [i.title, i.state, i.result, i.paneId]), [
    ["Team: Port the parser", "waiting", "Lead needs the schema", "l"],
    ["Team: Write docs", "done", "3 pages", undefined],
  ]);
});

test("waiting on you comes first, then running, failed and done; newest first inside each", () => {
  const input = empty();
  input.routines = [
    { id: "a", name: "done-old", at: 1, status: "idle" },
    { id: "b", name: "done-new", at: 9, status: "idle" },
    { id: "c", name: "run", at: 5, paneId: "x", status: "working" },
    { id: "d", name: "ask", at: 2, paneId: "y", status: "needs_input" },
  ];
  input.teams = [{ id: "t", task: "boom", status: "failed", summary: "", createdAt: 3, paneIds: [] }];
  assert.deepEqual(inboxItems(input).map((i) => i.title), ["Routine: ask", "Routine: run", "Team: boom", "Routine: done-new", "Routine: done-old"]);
});
