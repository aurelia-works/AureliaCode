/**
 * Preview harness for design screenshots: boots the real app (src/main.tsx) against a
 * scripted Tauri IPC, then drives agent state through the real stores (useAgents.handle,
 * the same path hook events take). Nothing here ships; `npm run build` never sees it.
 *
 *   /design/preview/?theme=dark&view=board|terminals|review|settings|start|palette|agentview
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import untangleSkill from "../../src-tauri/resources/untangle-codebase/SKILL.md?raw";

const params = new URLSearchParams(location.search);
const theme = (params.get("theme") ?? "dark") as "dark" | "light";
const view = params.get("view") ?? "terminals";
/** `view=chat&replay=<name>`: a fresh chat whose replies come from design/replays/<name>.jsonl (lib/replay.ts), no tokens. */
const REPLAY = params.get("replay");
const HOME = "/Users/you";
const dev = (p: string) => `${HOME}/dev/${p}`;

const enc = (s: string) => btoa(unescape(encodeURIComponent(s)));
const ESC = "\x1b";
const osc = (s: string) => `${ESC}]${s}\x07`;
const dim = (s: string) => `${ESC}[2m${s}${ESC}[0m`;
const bold = (s: string) => `${ESC}[1m${s}${ESC}[0m`;
const col = (n: number, s: string) => `${ESC}[${n}m${s}${ESC}[0m`;
const prompt = (cwd: string) => `${osc(`6973;cwd;${enc(cwd)}`)}${osc("133;A")}${col(36, cwd.replace(HOME, "~"))} ${col(33, "❯")} `;
const run = (cmd: string) => `${cmd}${osc(`6973;cmd;${enc(cmd)}`)}${osc("133;C")}\r\n`;
const done = (code: number) => osc(`133;D;${code}`);

function claudeScreen(cwd: string, body: string[]): string {
  return [prompt(cwd) + run("claude"), `${col(33, "✻")} Welcome to ${bold("Claude Code")}  ${dim(cwd.replace(HOME, "~"))}`, "", ...body].join("\r\n");
}

const SCREENS: Record<string, string> = {
  p1: claudeScreen(dev("api-server"), [
    `${col(90, ">")} run the pending migrations and fix the failing user test`,
    "",
    `${col(32, "⏺")} I'll check the migration status first.`,
    "",
    `${col(32, "⏺")} ${bold("Bash")}(npm run migrate:status)`,
    `  ⎿  3 pending: 0042_add_org_id, 0043_backfill, 0044_index`,
    "",
    col(38, "────────────────────────────────────────────────────"),
    ` ${bold("Bash command")}`,
    `   npm run migrate -- --to 0044`,
    `   ${dim("Apply 3 pending migrations")}`,
    ``,
    ` Do you want to proceed?`,
    ` ${col(36, "❯")} 1. Yes`,
    `   2. Yes, and don't ask again for npm run commands`,
    `   3. No, and tell Claude what to do differently (esc)`,
  ]),
  p2: claudeScreen(dev("web"), [
    `${col(90, ">")} make the settings page keyboard accessible`,
    "",
    `${col(32, "⏺")} ${bold("Read")}(src/settings/SettingsPage.tsx)`,
    `  ⎿  Read 214 lines`,
    `${col(32, "⏺")} ${bold("Edit")}(src/settings/SettingsPage.tsx)`,
    `  ⎿  Updated with 18 additions and 4 removals`,
    "",
    `${col(33, "✻")} Wiring roving tabindex… ${dim("(42s · ↓ 3.1k tokens · esc to interrupt)")}`,
  ]),
  p3: claudeScreen(dev("docs"), [
    `${col(90, ">")} rewrite the quickstart for the new CLI flags`,
    "",
    `${col(32, "⏺")} Updated docs/quickstart.md and docs/cli.md:`,
    `  • replaced --config with --profile in every example`,
    `  • added a "Multiple accounts" section`,
    `  • fixed 3 broken links`,
    "",
    `${col(32, "⏺")} Done. Want me to open a PR?`,
  ]),
  p4: claudeScreen(dev("payments"), [
    `${col(90, ">")} add idempotency keys to the refund endpoint`,
    "",
    `${col(32, "⏺")} ${bold("Bash")}(go test ./refunds/...)`,
    `  ⎿  ok  payments/refunds  4.211s`,
    `${col(32, "⏺")} ${bold("Bash")}(go test ./... -run Idempotency)`,
    "",
    `${col(33, "✻")} Running tests… ${dim("(1m 12s · esc to interrupt)")}`,
  ]),
  p5: claudeScreen(dev("infra"), [
    `${col(90, ">")} create the artifacts bucket with terraform`,
    "",
    `${col(32, "⏺")} The module needs a region. us-east-1 has the existing`,
    `  CDN origin, eu-west-1 keeps data in the EU for the Berlin team.`,
    "",
    `${col(32, "⏺")} Which region should the bucket live in?`,
  ]),
  p6: [
    prompt(dev("api-server")) + run("codex --oss"),
    `${bold("OpenAI Codex")} ${dim("(research preview) v0.42")}`,
    `${dim("model: gpt-oss:20b · provider: ollama")}`,
    "",
    `${col(35, "codex")} Reading src/routes/users.ts`,
    `${col(35, "codex")} The 500 comes from an unhandled null org_id.`,
    `${col(35, "codex")} Proposed patch: guard + 404 in getUserOrg()`,
    `${col(90, "▌")} apply patch? (y/n)`,
  ].join("\r\n"),
  p7: [
    prompt(dev("web")) + run("git status --short"),
    ` M src/settings/SettingsPage.tsx`,
    ` M src/settings/sections.css`,
    `?? src/settings/useRovingFocus.ts`,
    done(0) + "\r\n" + prompt(dev("web")) + run("npm test -- settings"),
    ``,
    ` ${col(32, "✓")} renders every section (41 ms)`,
    ` ${col(31, "✗")} moves focus with arrow keys (12 ms)`,
    ``,
    `   Expected: "appearance"`,
    `   Received: "general"`,
    ``,
    ` Tests: ${col(31, "1 failed")}, ${col(32, "1 passed")}, 2 total`,
    done(1) + "\r\n" + prompt(dev("web")) + run("npm run dev"),
    `  ${col(32, "VITE")} v8.3.2  ready in 212 ms`,
    `  ➜  Local:   ${col(36, "http://localhost:5173/")}`,
  ].join("\r\n"),
  p8: claudeScreen(dev("web"), [`${col(90, ">")} ${dim("Try \"refactor the router\"")}`]),
};

const PANES: Record<string, { cwd: string; account?: string; agent?: string; launcher?: boolean; mode?: "chat"; openedBy?: string }> = {
  p1: { cwd: dev("api-server"), account: "claude" },
  p2: { cwd: dev("web"), account: "claude-b" },
  p3: { cwd: dev("docs"), account: "work" },
  // The web thread started these two (aurelia_open_pane), so the grid shows the family both ways.
  p4: { cwd: dev("payments"), account: "claude", openedBy: "p2" },
  p5: { cwd: dev("infra"), account: "claude-b", openedBy: "p2" },
  p6: { cwd: dev("api-server"), agent: "codex:oss" },
  p7: { cwd: dev("web") },
  p8: { cwd: dev("web"), account: "work" },
  p9: { cwd: dev("api-server"), launcher: true },
  p10: params.get("opencode") === "1" ? { cwd: dev("web"), mode: "chat", provider: "opencode", chatModel: "opencode-go/deepseek-v4.1-flash" } : { cwd: dev("web"), account: "claude", mode: "chat" },
};

const pr = (number: number, title: string, over: Record<string, unknown>) => ({
  number, url: `https://github.com/you/repo/pull/${number}`, title, state: "OPEN", draft: false, review: "", conflicts: false, checks: "pending", failing: [], feedback: 0, ...over,
});
const PRS: Record<string, unknown> = {
  payments: pr(41, "Retry failed webhooks with backoff", { checks: "fail", failing: ["test (node 22)"], review: "CHANGES_REQUESTED", feedback: 3 }),
  web: pr(212, "Settings: keyboard navigation", { checks: "pending" }),
  infra: pr(9, "Move buckets to eu-west-2", { state: "MERGED", checks: "pass" }),
};

const atMin = (minutes: number) => Date.now() - minutes * 60_000;
const workPr = (number: number, state = "OPEN") => ({ number, url: `https://github.com/you/repo/pull/${number}`, state });
const WORK_ITEMS = [
  {
    id: "w1", title: "Fix the flaky focus test", description: "The roving tabindex test fails on the first run after a cold build.",
    project: dev("web"), status: "pending", harness: "claude", model: "sonnet-5", effort: "medium", cardId: "c2",
    createdAt: atMin(180), updatedAt: atMin(46),
  },
  {
    id: "w2", title: "Add idempotency keys to refunds", description: "Every retry should carry a key so a double submit refunds once.",
    project: dev("api-server"), status: "pending", harness: "codex", model: "gpt-5-codex", effort: "high",
    branch: "aurelia/refund-idempotency", createdAt: atMin(320), updatedAt: atMin(22),
  },
  {
    id: "w3", title: "Keyboard-accessible settings nav", description: "Roving tabindex across the settings rail; focus survives a section change.",
    project: dev("web"), status: "working", harness: "claude", model: "opus-5-5", effort: "high", paneId: "p2",
    branch: "feat/settings-a11y", pr: workPr(212), createdAt: atMin(240), updatedAt: atMin(2),
  },
  {
    id: "w4", title: "Retry failed webhooks with backoff", description: "Three attempts, then park the event and show it in the admin log.",
    project: dev("payments"), status: "working", harness: "codex", model: "gpt-5-codex", effort: "xhigh", paneId: "p6",
    worktree: { path: dev("payments"), branch: "aurelia/webhook-retry" }, branch: "aurelia/webhook-retry", pr: workPr(41), createdAt: atMin(400), updatedAt: atMin(1),
  },
  {
    id: "w5", title: "Backfill org_id for existing users", description: "Three migrations, then verify the new not-null constraint on a copy.",
    project: dev("api-server"), status: "review", harness: "claude", model: "opus-5-5", effort: "high", paneId: "p1",
    branch: "fix/user-org-null", pr: workPr(88), createdAt: atMin(600), updatedAt: atMin(9),
  },
  {
    id: "w6", title: "Move buckets to eu-west-2", description: "Terraform plan is clean; waiting on the Berlin team's sign-off.",
    project: dev("infra"), status: "review", harness: "claude", model: "sonnet-5", effort: "medium", paneId: "p5",
    worktree: { path: dev("infra"), branch: "infra/artifacts-bucket" }, branch: "infra/artifacts-bucket", pr: workPr(9), createdAt: atMin(1_440), updatedAt: atMin(120),
  },
  {
    id: "w7", title: "Rewrite the quickstart for the new CLI flags", description: "Replace --config with --profile in every example.",
    project: dev("docs"), status: "done", harness: "claude", model: "haiku-4-5", effort: "low", paneId: "p3",
    branch: "docs/quickstart", createdAt: atMin(2_880), updatedAt: atMin(360),
  },
  {
    id: "w8", title: "Bump vite to the next minor", project: dev("web"), status: "done", branch: "main",
    pr: workPr(198, "MERGED"), createdAt: atMin(4_320), updatedAt: atMin(1_440),
  },
];

const leaf = (id: string) => ({ type: "pane", id });
let sid = 0;
const split = (dir: "row" | "column", ratio: number, a: unknown, b: unknown) => ({ type: "split", id: `s${sid++}`, dir, ratio, a, b });
const row3 = (a: string, b: string, c: string) => split("row", 1 / 3, leaf(a), split("row", 0.5, leaf(b), leaf(c)));
const layout = {
  version: 1,
  activeTabId: view === "start" ? "t3" : view === "chat" ? "t4" : "t1",
  tabs: [
    { id: "t1", root: split("column", 0.5, row3("p1", "p2", "p3"), row3("p4", "p5", "p6")), focusedPaneId: "p2" },
    { id: "t2", root: split("row", 0.55, leaf("p7"), leaf("p8")), focusedPaneId: "p7" },
    { id: "t3", root: leaf("p9"), focusedPaneId: "p9" },
    { id: "t4", root: leaf("p10"), focusedPaneId: "p10" },
  ],
  panes: Object.fromEntries(Object.entries(PANES).map(([id, p]) => [id, { id, ...p }])),
};

// Agent view: label a few preview panes as saved agents, so the live list shows chips.
if (view === "tray") {
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  await import("../../src/tray/tray.css");
  const { Tray } = await import("../../src/tray/Tray.tsx");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;z-index:70;background:#3a4a5c;padding:24px;";
  const inner = document.createElement("div");
  inner.style.cssText = "width:320px;";
  host.append(inner);
  document.body.append(host);
  createRoot(inner).render(createElement(Tray));
}
if (view === "agentview") {
  Object.assign(layout.panes.p1, { customAgent: "ag1" });
  Object.assign(layout.panes.p2, { customAgent: "ag2" });
  Object.assign(layout.panes.p3, { customAgent: "ag3" });
  Object.assign(layout.panes.p4, { customAgent: "ag4" });
}

const config = {
  accounts: [
    { name: "claude", configDir: "~/.claude" },
    { name: "claude-b", configDir: "~/.claude-b" },
    { name: "work", configDir: "~/.claude-work" },
  ],
  usageScript: "",
  usageRefreshSeconds: 120,
  theme,
  palette: params.get("palette") ?? "aurelia",
  notifications: true,
  hud: { enabled: false },
  sounds: { enabled: true, volume: 60, events: {}, projects: {} },
  push: { enabled: false, server: "", topic: "", detail: false },
  proxy: { enabled: false, port: 8317 },
  contextCompression: { accounts: params.get("compress") === "on" || params.get("compress") === "active" || params.get("compress") === "failed" ? ["work"] : [] },
  tray: { enabled: true, animate: false, size: 18, color: "", streamer: params.get("streamer") === "1" },
  discord: { enabled: false, clientId: "", hideProject: false },
  defaultAccount: "claude",
  // ?setup=1 shows the one-time setup on the start screen.
  setupDone: params.get("setup") !== "1",
  workspaceAccounts: {},
  editor: "",
  defaultWorkspace: "~/dev",
  terminal: { fontFamily: '"SF Mono", Menlo, monospace', fontSize: 12, lineHeight: 1.2, scrollback: 5000, optionAsMeta: true, webglPaneLimit: 0, shell: "/bin/zsh" },
  suggestions: {
    provider: "ollama",
    ollama: { baseUrl: "http://localhost:11434", model: "qwen2.5-coder:1.5b" },
    gemini: { baseUrl: "", model: "gemini-2.0-flash" },
    openrouter: { baseUrl: "", model: "" },
  },
  cache: { ttlMinutes: 60 },
  voice: { shellCleanup: false },
  resumeOnLaunch: true,
  openFilesInApp: true,
  subagents: { enabled: true, model: "opencode-go/deepseek-v4.1-flash", timeoutMinutes: 20 },
  effort: { auto: true, judge: true, floor: "low", ceiling: "max", autoModel: false },
  remote: { enabled: true, port: 4747, allowLan: false, tailscaleHttps: true, httpsPort: 443 },
  claudePermissionMode: "",
  routines: [
    { id: "r1", name: "Morning triage", enabled: true, kind: "daily", time: "09:00", minutes: 60, weekdaysOnly: true, account: "work", cwd: "~/dev/api-server", prompt: "Check CI on main and the open PRs; summarise what failed and why." },
  ],
};

const inAnHour = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();const USAGE: Record<string, unknown> = {
  claude: { fiveHour: 62, sevenDay: 41, fiveHourResetsAt: inAnHour(2.2), sevenDayResetsAt: inAnHour(80), updatedAt: Date.now() },
  "claude-b": { fiveHour: 91, sevenDay: 73, fiveHourResetsAt: inAnHour(0.7), sevenDayResetsAt: inAnHour(30), updatedAt: Date.now() },
  work: { fiveHour: 14, sevenDay: 22, fiveHourResetsAt: inAnHour(4), sevenDayResetsAt: inAnHour(120), updatedAt: Date.now() },
};

// What each repo's thread has changed (git_diffstat), so rows and cards show +/- like they would live.
const DIFFSTAT: Record<string, { files: number; additions: number; deletions: number }> = {
  web: { files: 3, additions: 42, deletions: 7 },
  "api-server": { files: 2, additions: 18, deletions: 4 },
  payments: { files: 9, additions: 340, deletions: 61 },
  infra: { files: 1, additions: 6, deletions: 0 },
  docs: { files: 2, additions: 64, deletions: 12 },
};
const BRANCH: Record<string, string> = {
  "api-server": "fix/user-org-null",
  web: "feat/settings-a11y",
  docs: "main",
  payments: "aurelia/refund-idempotency",
  infra: "infra/artifacts-bucket",
};

const DIFF = `diff --git a/src/settings/SettingsPage.tsx b/src/settings/SettingsPage.tsx
index 3b1c2a1..9f0e7d2 100644
--- a/src/settings/SettingsPage.tsx
+++ b/src/settings/SettingsPage.tsx
@@ -12,9 +12,14 @@ export function SettingsPage() {
   const [section, setSection] = useState(SECTIONS[0].id);
-  const onKey = (e: KeyboardEvent) => {
-    if (e.key === "Escape") close();
-  };
+  const nav = useRovingFocus(SECTIONS.length);
+  const onKey = (e: KeyboardEvent) => {
+    if (e.key === "Escape") return close();
+    nav.onKeyDown(e);
+  };

   return (
-    <nav className="settings-nav">
+    <nav className="settings-nav" role="tablist" aria-orientation="vertical">
       {SECTIONS.map((s, i) => (
-        <button key={s.id} onClick={() => setSection(s.id)}>
+        <button key={s.id} role="tab" tabIndex={nav.index === i ? 0 : -1} onClick={() => setSection(s.id)}>
diff --git a/src/settings/useRovingFocus.ts b/src/settings/useRovingFocus.ts
new file mode 100644
--- /dev/null
+++ b/src/settings/useRovingFocus.ts
@@ -0,0 +1,9 @@
+import { useState } from "react";
+
+export function useRovingFocus(count: number) {
+  const [index, setIndex] = useState(0);
+  const onKeyDown = (e: KeyboardEvent) => {
+    if (e.key === "ArrowDown") setIndex((i) => (i + 1) % count);
+    if (e.key === "ArrowUp") setIndex((i) => (i - 1 + count) % count);
+  };
+  return { index, onKeyDown };
+}
diff --git a/src/settings/sections.css b/src/settings/sections.css
index 1111111..2222222 100644
--- a/src/settings/sections.css
+++ b/src/settings/sections.css
@@ -3,4 +3,7 @@
 .settings-nav button {
   padding: 6px 10px;
 }
+.settings-nav button:focus-visible {
+  outline: 2px solid currentColor;
+}
`;

type Channel = { id: number };
let channelIndex = new Map<number, number>();
function emit(ch: Channel, message: unknown) {
  const index = channelIndex.get(ch.id) ?? 0;
  channelIndex.set(ch.id, index + 1);
  (window as any).__TAURI_INTERNALS__.runCallback(ch.id, { index, message });
}
function feed(ch: Channel, text: string) {
  emit(ch, new TextEncoder().encode(text).buffer);
}

/** A stand-in for Claude Code's input line and /effort picker, enough to exercise lib/inlineEffort. */
const channels = new Map<string, Channel>();
const inputs = new Map<string, string>();
const writes: { pane: string; data: string }[] = [];
(window as any).__writes = writes;
function ptyWrite(pane: string, data: string) {
  writes.push({ pane, data });
  const ch = channels.get(pane);
  if (!ch) return;
  let cur = inputs.get(pane) ?? "";
  // A whole command line (the pane's startup "claude\r"): the scripted screen already shows it.
  if (data.length > 1 && data.endsWith("\r")) return;
  if (data.startsWith("\x1b[200~")) cur += data.slice(6, -6);
  else if (data === "\r") {
    if (cur === "/effort") feed(ch, "\r\n Effort  low  medium  [high]  xhigh  max   (s: this session only)\r\n");
    else if (cur) feed(ch, `\r\n${ESC}[32m⏺${ESC}[0m submitted: ${cur}\r\n`);
    cur = "";
  } else if (/^\x7f+$/.test(data)) cur = [...cur].slice(0, -data.length).join("");
  else if (!data.startsWith(ESC) && !/^[\x00-\x1f]/.test(data)) cur += data;
  inputs.set(pane, cur);
  feed(ch, `\r${ESC}[2K> ${cur}`);
}

/** Agent view (?view=agentview): saved agents, one team, and two runs to show running and blocked. */
const AGENTS = [
  { id: "ag1", name: "Architect", variant: "claude:claude", color: "gold", instructions: "" },
  { id: "ag2", name: "Second pair of eyes", variant: "claude:claude-b", color: "violet", instructions: "" },
  { id: "ag3", name: "Codex runner", variant: "codex:oss", color: "blue", instructions: "" },
  { id: "ag4", name: "Gemini runner", variant: "gemini:login", color: "teal", instructions: "" },
] as const;
const TEAMS = [{ id: "team-1", name: "Ship it", agentIds: ["ag1", "ag2", "ag3", "ag4"], leadId: "ag1", routing: "balanced", maxConcurrency: 4 }];
const RUNS = [
  {
    id: "run-1",
    teamId: "team-1",
    task: "Ship the settings keyboard fix: tests, implementation, then review the diff",
    plan: {
      leadId: "ag1",
      maxConcurrency: 4,
      workers: [
        { agentId: "ag2", role: "test writer", model: "claude-haiku-4-5" },
        { agentId: "ag3", role: "builder", model: "gpt-5-codex" },
        { agentId: "ag4", role: "verifier", model: "gemini-2.5-pro" },
      ],
    },
    paneIds: ["p2", "p7", "p6"],
    status: "running",
    summary: "",
    createdAt: Date.now() - 4 * 60_000,
  },
  {
    id: "run-2",
    teamId: "team-1",
    task: "Move the artifact bucket to eu-west-2 and update the CDN origin",
    plan: {
      leadId: "ag1",
      maxConcurrency: 3,
      workers: [
        { agentId: "ag2", role: "reviewer", model: "claude-opus-4-1" },
        { agentId: "ag3", role: "security reviewer", model: "gpt-5-codex" },
      ],
    },
    paneIds: ["p5", "p8"],
    status: "blocked",
    summary:
      "OVERALL: BLOCKED\nreviewer — PASS — no secrets in the diff\nsecurity reviewer — BLOCKED — the eu-west-2 bucket policy needs a decision: keep the public read on assets/ or move it to CloudFront OAC.",
    createdAt: Date.now() - 38 * 60_000,
  },
];

const plannerMock = {  version: 1,
  importedAt: "2026-10-28T09:00:00.000Z",
  projects: [{ id: "p1", name: "Linkra", status: "In Progress", localRepoPath: dev("web"), tasks: [] }, { id: "p2", name: "ATA", status: "In Progress", localRepoPath: dev("api-server"), tasks: [] }],
  goalTemplate: [
    { id: "t1", title: "Ship one focused task", category: "Build", points: 3, done: false },
    { id: "t2", title: "Write session log", category: "Review", points: 2, done: false },
  ],
  dailyGoalsByDate: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`2026-03-${10 + i}`, {}])),
  roadmapCards: [
    { id: "c1", lane: "now", title: "Linkra v3 import", description: "", tags: [], dueDate: "2026-11-02", project: "p1" },
    { id: "c2", lane: "next", title: "Habit streaks", description: "", tags: [], dueDate: null, project: "p1" },
    { id: "c3", lane: "later", title: "Calendar week view", description: "", tags: [], dueDate: null, project: "p1" },
    { id: "c4", lane: "shipped", title: "Planner store", description: "", tags: [], dueDate: null, project: "p1" },
    { id: "c5", lane: "next", title: "Fix platform doors", description: "", tags: [], dueDate: null, project: "p2" },
  ],
  focusSessions: Array.from({ length: 5 }, (_, i) => ({ id: `f${i}` })),
  habits: [{ id: "h1", title: "Read 20 pages", frequency: "daily", customDays: [], targetStreak: 30, archivedAt: null }, { id: "h2", title: "Stretch", frequency: "weekdays", customDays: [], targetStreak: 30, archivedAt: null }],
  habitCompletions: [-1, -2, -3].map((d, i) => { const x = new Date(Date.now() + d * 86400000); return { id: `hc${i}`, habitId: "h1", date: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`, createdAt: "" }; }),
  switches: {},
};

// Replay: each sent message plays the recording's next turn through the chat's real channel.
const { parseReplay, turnEvents } = await import("../../src/lib/replay.ts");
const replayTurns = REPLAY
  ? await (async () => {
      const res = await fetch(`/design/replays/${REPLAY}.jsonl`);
      if (!res.ok) throw new Error(`no replay ${REPLAY}`);
      return parseReplay(await res.text());
    })()
  : [];
const replayCh = new Map<string, Channel>();
const replayAt = new Map<string, number>();
async function playReplay(paneId: string) {
  const ch = replayCh.get(paneId);
  const n = replayAt.get(paneId) ?? 0;
  replayAt.set(paneId, n + 1);
  const turn = replayTurns[n];
  if (!ch) return;
  const events = turn ? turnEvents(turn) : [{ type: "turnEnd", outcome: "failed", error: "the replay has no more turns" }, { type: "status", status: "idle" }];
  for (const ev of events) {
    await sleep(Number(params.get("replayMs") ?? 60));
    emit(ch, ev);
  }
}

mockWindows("main");
mockIPC(
  (cmd, args: any) => {
    // Checks read what the UI asked the backend for (e.g. the phone remote's wiring).
    ((window as any).__cmds ??= []).push({ cmd, args });
    switch (cmd) {
      case "store_health":
        return { ok: true, threads: 42, events: 1318, path: "/Users/jah/Library/Application Support/space.aurelia.code/aurelia.db" };
      case "remote_snapshot":
        (window as any).__remoteSnap = args.snapshot;
        return null;
      case "proxy_status":
        return { installed: true, running: false, signedIn: false };
      case "context_compression_status": {
        const mode = params.get("compress");
        if (mode === "active") return { phase: "ready", version: null, reason: null, claude: true, active: [{ paneId: "p1", account: "work" }], failures: [] };
        if (mode === "on") return { phase: "ready", version: null, reason: null, claude: true, active: [], failures: [] };
        if (mode === "failed") return { phase: "ready", version: null, reason: null, claude: true, active: [], failures: [{ paneId: "p1", account: "work", code: 2 }] };
        if (mode === "unavailable") return { phase: "unavailable", version: null, reason: "Claude Code isn't on PATH.", claude: false, active: [], failures: [] };
        return { phase: "absent", version: null, reason: null, claude: true, active: [], failures: [] };
      }
      case "context_compression_install":
        return "0.0.0-preview";
      case "context_compression_dismiss":
        return null;
      case "tray_accounts":
        return [
          { name: "a", email: "jah@aurelia.space", plan: "Max 5x" },
          { name: "b", email: "studio@aurelia.space", plan: "Max 20x" },
        ];
      case "ledger_summary": {
        const win = (id: string, f: number) => ({
          id,
          usd: 41.27 * f,
          tokens: 58_400_000 * f,
          models: [
            { model: "opus-5-5", usd: 33.12 * f, tokens: 41_000_000 * f },
            { model: "sonnet-5-5", usd: 7.9 * f, tokens: 16_000_000 * f },
            { model: "haiku-5-5", usd: 0.25 * f, tokens: 1_400_000 * f },
          ],
          unpriced: [],
        });
        return { windows: [win("24h", 0.2), win("7d", 1), win("30d", 3.4)], pricesAt: Date.now() / 1000 };
      }
      case "real_spend":
        return [
          { provider: "anthropic", days: null, note: "no key" },
          { provider: "openai", days: [0.4, 2.1, 9.8], note: null },
        ];
      case "remote_status":
      case "remote_unpair":
      case "remote_reset_token":
      case "remote_apply":
        return {
          enabled: true,
          running: true,
          port: 4747,
          error: null,
          links: [{ label: "Tailscale HTTPS", url: "https://jahs-mac.tail1234.ts.net/pair?k=0f3a" }],
          qrSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="21" height="21" fill="#fff"/><path d="M1 1h7v7H1zM13 1h7v7h-7zM1 13h7v7H1z" fill="#000"/></svg>`,
          codeExpiresIn: 840,
          tailscale: { state: "ready", ip: "100.101.102.103", dnsName: "jahs-mac.tail1234.ts.net", httpsAvailable: false, detail: null },
          serving: false,
          serveError: "Serve isn't enabled on your tailnet. Turn it on here, then try again: https://login.tailscale.com/f/serve?node=abc",
          devices: [
            { id: "d1", name: "iPhone", pairedAt: Date.now() / 1000 - 86400 * 3, lastSeen: Date.now() / 1000 - 120 },
            { id: "d2", name: "Phone paired before", pairedAt: Date.now() / 1000 - 86400 * 30, lastSeen: 0 },
          ],
          clients: 1,
        };
      case "remote_test":
        return { ok: false, url: "https://jahs-mac.tail1234.ts.net", ms: null, error: "Timed out: Tailscale didn't route to this Mac." };
      case "get_config":
        return structuredClone(config);
      case "save_config":
        Object.assign(config, args.config);
        return null;
      case "load_state":
        // ?unreadable=layout,tasks: those files exist but can't be read (lib/savedState.ts); nothing may be saved over them.
        if ((params.get("unreadable") ?? "").split(",").includes(args.name)) throw new Error(`${args.name}.json: Permission denied (os error 13)`);
        if (args.name === "layout") return structuredClone(layout);
        if (args.name === "ui") return { mode: view === "board" ? "agents" : view === "work" ? "work" : "terminals", agentPanelOpen: params.get("rail") !== null, nav: "projects" };
        if (args.name === "work") return { items: WORK_ITEMS };
        // ?queue=1: web's PR waits on checks; payments' was sent back.
        if (args.name === "mergequeue" && params.get("queue"))
          return [
            { paneId: "p2", pr: 212, stage: "checks", at: atMin(4), sha: "a1b2c3d4e5f6" },
            { paneId: "p4", pr: 41, stage: "bounced", at: atMin(30), reason: "Checks failed: test (node 22)" },
          ];
        if (args.name === "tasks")
          return {
            projects: {
              [dev("web")]: [
                { id: "k1", title: "Keyboard-accessible settings nav", status: "doing", paneId: "p2", createdAt: 1 },
                { id: "k2", title: "Fix flaky focus test", status: "todo", createdAt: 2 },
                { id: "k3", title: "Dark mode contrast pass", status: "todo", createdAt: 3 },
                { id: "k4", title: "Bump vite", status: "done", createdAt: 4 },
              ],
            },
          };
        if (args.name === "planner") return plannerMock;
        if (args.name === "agents" && (view === "agentview" || view === "settings")) return { agents: AGENTS, teams: TEAMS };
        if (args.name === "teamruns" && view === "agentview") return { runs: RUNS };
        if (args.name === "recents") return { folders: [dev("web"), dev("api-server"), dev("payments"), dev("infra"), dev("docs")] };
        return null;
      case "pty_spawn":
        channels.set(args.paneId, args.onData);
        setTimeout(() => feed(args.onData, SCREENS[args.paneId] ?? prompt(args.cwd ?? HOME)), 60);
        return { attached: false };
      case "pty_write":
        ptyWrite(args.paneId, args.data);
        return null;
      case "choose_effort":
        return /typo/.test(args.prompt ?? args.text ?? "") ? { level: "low", source: "rules", why: "small edit", pending: false } : { level: null, source: "keep", why: "nothing to change", pending: false };
      case "git_last_commit":
        return String(args.cwd).endsWith("api-server") ? Math.floor(Date.now() / 1000) - 20 * 86400 : Math.floor(Date.now() / 1000) - 8 * 86400;
      case "git_info": {
        const name = String(args.cwd).split("/").pop()!;
        return BRANCH[name] ? { root: args.cwd, branch: BRANCH[name], detached: false, worktree: name === "payments", repo: args.cwd } : null;
      }
      case "council_review":
        return [
          { model: "opencode-go/deepseek-v4.1-flash", text: "Correctness: FAIL - focus can escape the nav\n- [important] src/components/ChatPane.tsx:41 - Escape closes the picker but focus is lost to <body>\n- [nit] src/lib/gitDialog.ts:12 - `msg` could be named `summary`\n- [pre-existing] src/lib/new-helper.ts:3 - this helper never handled an empty list\nSCORE: 7/10\nVERDICT: fix", failed: false, seconds: 74 },
          { model: "opencode-go/kimi-k2", text: "- [important] src/components/ChatPane.tsx:43 - after Escape the focused element is removed, so keyboard users lose their place\n- [important] src/lib/gitDialog.ts:30 - the commit message isn't trimmed before the empty check\nSCORE: 8/10\nVERDICT: fix", failed: false, seconds: 81 },
        ];
      case "explain_changes":
        return "What is changing\nThe chat picker gets keyboard handling (Escape closes it) and the commit dialog gains a summary helper.\n\nWhy\nKeyboard users couldn't leave the picker without the mouse.\n\nWhere is the risk\nFocus after Escape: check it returns to the composer. The new helper is untested on an empty change list.";
      case "git_diffstat":
        return DIFFSTAT[String(args.cwd).split("/").pop()!] ?? { files: 0, additions: 0, deletions: 0 };
      case "make_scratch":
        return `/Users/you/scratch/${args.name}`;
      case "resolve_paths":
        return args.candidates;
      case "diff_scope":
        return { root: dev("web"), diff: DIFF, truncated: false };
      case "pr_history": {
        // Human time (Work board, one project picked): mostly agent PRs with bot reviews, one person, one revert.
        const at = (h: number) => new Date(Date.now() - (200 - h) * 3_600_000).toISOString();
        const bot = { login: "coderabbitai[bot]", is_bot: true };
        return Array.from({ length: 12 }, (_, i) => ({
          number: 100 + i, title: i === 11 ? "Revert \"feat: retry webhooks\"" : `feat: change ${i}`, body: i === 11 ? "Reverts you/repo#104" : "",
          author: { login: "you" }, createdAt: at(i * 10), mergedAt: at(i * 10 + 3), labels: i === 6 ? [{ name: "hotfix" }] : [],
          reviews: [{ author: bot, state: "APPROVED", submittedAt: at(i * 10 + 1) }, ...(i % 4 === 0 ? [{ author: { login: "sam" }, state: "APPROVED", submittedAt: at(i * 10 + 2) }] : [])],
          comments: [{ author: { login: "you" }, body: "<!-- pr-verdict -->\nVerdict: PASS", createdAt: at(i * 10 + 2) }],
        }));
      }
      case "pr_sync":
        return { sha: "a1b2c3d4e5f6", conflict: false };
      case "pr_comments":
        return { headRefOid: "a1b2c3d4e5f6", headRefName: "feat/x", comments: [] };
      case "pr_merge":
        return null;
      // ?dev=1: web's thread runs its dev server on its own port.
      case "dev_server_list":
        return params.get("dev") ? [{ pane: "p2", cwd: dev("web"), port: 5174, url: "http://127.0.0.1:5174", command: "npm run dev -- --port 5174", running: true }] : [];
      case "dev_server_start":
        return { pane: args.pane, cwd: args.cwd, port: 5175, url: "http://127.0.0.1:5175", command: "npm run dev -- --port 5175", running: true };
      case "dev_server_log":
        return [];
      case "dev_server_stop":
        return null;
      // ?share=1: the web chat thread (p10) is shared and a guest has asked something.
      case "share_list":
        return params.get("share") ? [{ pane: "p10", expires: Math.floor(Date.now() / 1000) + 20 * 3600 }] : [];
      case "share_asks":
        return params.get("share") ? [{ id: "q1", pane: "p10", text: "Could you also cover the Escape key in the settings nav test?", at: Math.floor(Date.now() / 1000) }] : [];
      case "share_create":
        return { pane: args.pane, urls: ["https://mac.tailnet.ts.net/s/3f9c0d7a"], expires: Math.floor(Date.now() / 1000) + 86400 };
      case "share_feed":
        return true;
      case "share_take":
      case "share_revoke":
        return null;
      case "pr_status":
        return PRS[String(args.cwd).split("/").pop()!] ?? null;
      case "fetch_usage":
        return USAGE[args.account] ?? null;
      case "project_root":
        return args.cwd;
      case "git_diff":
        return { root: dev("web"), diff: DIFF, truncated: false };
      case "git_changes":
        return [
          { path: "src/components/ChatPane.tsx", status: "M", staged: false, untracked: false },
          { path: "src/lib/gitDialog.ts", status: "A", staged: false, untracked: false },
          { path: "src/lib/new-helper.ts", status: "?", staged: false, untracked: true },
          { path: ".env.local", status: "?", staged: false, untracked: true },
        ];
      case "git_commit":
        return "a1b2c3d";
      case "git_push":
        return "Pushed main to origin";
      case "git_create_pr":
        return { number: 42, url: "https://github.com/aurelia-works/AureliaSpace/pull/42", state: "OPEN", title: args.title, draft: true };
      case "store_threads":
      case "store_thread_search":
        return [
          { id: "h1", title: "Fix composer key handling", cwd: "/Users/you/dev/web", project: "web", harness: "claude", status: "closed", updatedAt: Date.now() - 3600_000 },
          { id: "h2", title: "DeepSeek swarm audit", cwd: "/Users/you/dev/api", project: "api", harness: "terminal", status: "open", updatedAt: Date.now() - 86400_000 },
        ];
      case "list_dir":
        if (String(args.path).includes("skills")) {
          return ["ds-swarm", "ds-tdd", "ds-review-loop", "ds-principles", "ds-ship", "ds-verify-loop"].map((n) => ({
            name: n,
            path: `${args.path}/${n}`,
            dir: true,
          }));
        }
        return ["src", "public", "package.json", "tsconfig.json", "vite.config.ts", "README.md", ".gitignore"].map((n) => ({
          name: n,
          path: `${args.path}/${n}`,
          dir: !n.includes("."),
        }));
      case "read_text_file":
        if (String(args.path).endsWith("/SKILL.md")) {
          const name = String(args.path).split("/").slice(-2)[0];
          return {
            text: `---\nname: ${name}\ndescription: ${name === "ds-swarm" ? "Fan out N parallel workers on slices of a job." : "A DeepSeek skill from the GITHUB REPOS pack."}\n---\n\n# ${name}\n\nFollow the procedure and report PASS, ISSUES or BLOCKED with evidence.`,
            mtimeMs: 0,
          };
        }
        return { text: "", mtimeMs: 0 };
      case "read_attachment": {
        // &attach=1: files dropped from Finder, by name. big.pdf is over the 32 MB cap.
        const path = String(args.path);
        const name = path.split("/").pop()!;
        if (name === "big.pdf" && args.read) throw "big.pdf is over the 32 MB a message can carry";
        const data: Record<string, string> = {
          "shot.png": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "spec.pdf": "JVBERi0xLjQK",
          "rows.csv": btoa("name,score\nada,9\n"),
        };
        const size: Record<string, number> = { "shot.png": 70, "spec.pdf": 284_000, "rows.csv": 18, "Deck.pptx": 2_400_000, "big.pdf": 41_000_000 };
        return { name, size: size[name] ?? 1000, data: args.read ? (data[name] ?? "") : "" };
      }
      case "project_files":
        return ["src/App.tsx", "src/components/Composer.tsx", "src/components/ChatPane.tsx", "src/lib/chat.ts", "package.json", "README.md"];
      case "app_bundle_path":
        return "/Applications/AureliaCode.app";
      case "providers": {
        const all = ["chat", "resume", "interrupt", "steer", "effort", "images", "files", "mcp"];
        const claude = (name: string, signedIn: boolean, auth: string) => ({ id: `claude:${name}`, provider: "claude", label: `Claude · ${name}`, installed: true, path: "/opt/homebrew/bin/claude", version: "2.1.318", signedIn, auth, email: signedIn ? `${name}@example.com` : null, models: [], caps: all });
        return [
          claude("claude", true, "Claude.ai account, Max plan"),
          claude("claude-b", true, "Claude.ai account, Pro plan"),
          claude("work", false, null),
          { id: "opencode", provider: "opencode", label: "OpenCode", installed: true, path: "/opt/homebrew/bin/opencode", version: "2.0.15", signedIn: true, auth: "OpenCode Go, OpenAI", models: ["opencode-go/deepseek-v4-pro", "opencode-go/deepseek-v4.1-flash", "opencode-go/glm-5.3", "openai/gpt-5.5"], caps: ["chat", "resume", "interrupt", "effort", "files", "mcp"] },
          { id: "gemini", provider: "gemini", label: "Gemini CLI", installed: true, path: "/opt/homebrew/bin/gemini", version: "0.46.0", signedIn: true, auth: "Google sign-in", models: [], caps: ["resume", "files", "mcp"] },
          { id: "grok", provider: "grok", label: "Grok", installed: true, path: "~/.grok/bin/grok", version: "1.0.70", signedIn: false, models: ["grok-4.6", "grok-4.5"], defaultModel: "grok-4.6", caps: ["resume", "effort", "mcp"] },
          { id: "codex", provider: "codex", label: "OpenAI Codex", installed: true, path: "/opt/homebrew/bin/codex", version: "0.166.0", signedIn: true, auth: "ChatGPT", models: [], caps: ["resume", "effort", "images", "mcp"] },
          { id: "cursor", provider: "cursor", label: "Cursor CLI", installed: false, models: [], caps: ["resume", "mcp"] },
          { id: "copilot", provider: "copilot", label: "GitHub Copilot", installed: false, models: [], caps: ["resume", "mcp"] },
        ];
      }
      case "has_full_disk_access":
        if (view === "permissions") return false;
      case "which":
      case "voice_installed":
        return true;
      case "agent_keys_present":
      case "take_prompt_links":
        return [];
      case "has_api_key":
        return false;
      case "audit_folders":
        return { root: args.cwd, folders: ["src", "src/refunds"] };
      case "council_audit":
        return [{ model: "a", text: "SCORE: 9/10\nVERDICT: ship", failed: false, seconds: 1 }, { model: "b", text: "SCORE: 9/10\nVERDICT: ship", failed: false, seconds: 1 }];
      case "chat_history":
        if (REPLAY) return [];
        // The scripted chat (view=chat) is the whole story: never load or spawn over it.
        return new Promise(() => {});
      case "chat_spawn":
        if (REPLAY) replayCh.set(args.paneId, args.onEvent);
        return {};
      case "chat_send":
        if (REPLAY) void playReplay(args.paneId);
        return null;
      case "chat_commands":
        return params.get("untangle") === "1"
          ? { commands: [{ name: "untangle-codebase", description: "Untangle a whole codebase in one pass.", argumentHint: "[optional area or concern to focus on]" }] }
          : { commands: [] };
      case "untangle_status":
      case "untangle_install": {
        const account = String(args.account ?? "");
        const dir = account === "work" ? "/Users/you/.claude-work" : account === "claude-b" ? "/Users/you/.claude-b" : "/Users/you/.claude";
        if (account === "claude") {
          return {
            state: "unavailable",
            reason: "The shared ~/.claude account is not an isolated Claude config. Install is unavailable, so this skill is not written there.",
            configDir: dir,
            skillDir: null,
          };
        }
        if (cmd === "untangle_install" || account === "work") {
          return {
            state: "installed",
            reason: "Installed and matches the bundled skill.",
            configDir: dir,
            skillDir: `${dir}/skills/untangle-codebase`,
          };
        }
        return {
          state: "notInstalled",
          reason: "Not installed. New sessions will not list /untangle-codebase until you install it into this account.",
          configDir: dir,
          skillDir: `${dir}/skills/untangle-codebase`,
        };
      }
      case "untangle_asset":
        return {
          skill: untangleSkill,
          license: "MIT License\n\nCopyright (c) 2026 Maze\n",
          notice: "Adapted from caldoai/skills, MIT, Copyright (c) 2026 Maze\nhttps://github.com/caldoai/skills/tree/main/skills/untangle-codebase\n",
        };
      case "transcript_usage":
        return { entries: [], offset: 0 };
      case "plugin:path|resolve_directory":
        return HOME;
      case "plugin:notification|is_permission_granted":
        return true;
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

// `?ipcMs=4`: every IPC call (events included) takes that long, like a round trip to Rust,
// so boot steps that wait on each other show up in `npm run perf`. `__ipcLog` counts every call.
{
  const internals = (window as any).__TAURI_INTERNALS__;
  const inner = internals.invoke;
  const ipcMs = Number(params.get("ipcMs") ?? 0);
  if (params.get("perf")) (window as any).__perfProfile = { commits: 0, ms: 0 };
  internals.invoke = async (cmd: string, args: unknown, opts: unknown) => {
    ((window as any).__ipcLog ??= []).push({ cmd, at: performance.now() });
    if (ipcMs) await new Promise((r) => setTimeout(r, ipcMs));
    return inner(cmd, args, opts);
  };
}

// Settle: boot, let PTYs paint, then play hook events through the real agent store.
await import("../../src/main.tsx");
const { useAgents } = await import("../../src/store/agents.ts");
const { useMetrics } = await import("../../src/store/metrics.ts");
const { useUi } = await import("../../src/store/ui.ts");
const { useLayout } = await import("../../src/store/layout.ts");
const { useNotices } = await import("../../src/store/notifications.ts");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
await sleep(400);
useUi.setState({ windowFocused: true });
const ev = (pane: string, event: string, payload: Record<string, unknown> = {}) =>
  useAgents.getState().handle({ pane, event, configDir: "", ts: Date.now(), payload: { session_id: `s-${pane}`, cwd: PANES[pane].cwd, ...payload } });

const minutesAgo = (m: number) => Date.now() - m * 60_000;
for (const p of ["p1", "p2", "p3", "p4", "p5", "p8"]) ev(p, "SessionStart");
ev("p1", "UserPromptSubmit");
ev("p1", "Notification", { notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" });
ev("p2", "UserPromptSubmit", { permission_mode: "auto" });
ev("p2", "PreToolUse", { tool_name: "Read", tool_input: { file_path: "/Users/you/dev/web/src/settings/Nav.tsx" } });
ev("p2", "PreToolUse", { tool_name: "Grep", tool_input: { pattern: "onKeyDown" } });
ev("p2", "PreToolUse", { tool_name: "Bash", tool_input: { command: "npm test -- settings-nav" } });
ev("p2", "PreToolUse", { tool_name: "Edit", tool_input: { file_path: "/Users/you/dev/web/src/settings/Nav.tsx" } });
ev("p3", "UserPromptSubmit");
ev("p3", "PreToolUse", { tool_name: "Read", tool_input: { file_path: "/Users/you/dev/docs/quickstart.md" } });
ev("p3", "PreToolUse", { tool_name: "Edit", tool_input: { file_path: "/Users/you/dev/docs/quickstart.md" } });
ev("p3", "PreToolUse", { tool_name: "Bash", tool_input: { command: "npm run docs:check" } });
ev("p3", "Stop");
ev("p4", "UserPromptSubmit", { permission_mode: "plan" });
ev("p4", "PreToolUse", { tool_name: "Read", tool_input: { file_path: "/Users/you/dev/payments/src/refunds.ts" } });
ev("p4", "PreToolUse", { tool_name: "Bash", tool_input: { command: "pnpm vitest refunds" } });
ev("p5", "UserPromptSubmit");
ev("p5", "Notification", { notification_type: "elicitation", message: "Which region should the bucket live in?" });

// Status lines, as Claude Code's statusline.sh reports them.
const live = (pane: string, effort: string, cost: number, ctx: number) =>
  ev(pane, "StatusLine", {
    model: { id: "claude-opus-5-5", display_name: "Opus 5.5" },
    effort: { level: effort },
    cost: { total_cost_usd: cost },
    context_window: { context_window_size: 1_000_000, current_usage: { input_tokens: ctx, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    rate_limits: { five_hour: { used_percentage: 62, resets_at: Date.now() / 1000 + 7900 }, seven_day: { used_percentage: 41, resets_at: Date.now() / 1000 + 288000 } },
    prompt_cache: { warm: true, expires_at: Date.now() / 1000 + 2400, ttl: "1h", requests: 18, misses: 1, hit_ratio: 0.94 },
  });
live("p1", "high", 1.84, 380_000);
live("p2", "medium", 3.12, 570_000);
live("p3", "high", 0.71, 220_000);
live("p4", "xhigh", 7.9, 880_000);

// Spread the timestamps out so ages and the cache timer read like a real afternoon.
const ages: Record<string, [number, number]> = { p1: [3, 3], p2: [1, 0.5], p3: [7, 8], p4: [2, 0.2], p5: [5, 6], p8: [24, 52] };
useAgents.setState((s) => ({
  sessions: Object.fromEntries(
    Object.entries(s.sessions).map(([id, x]) => [id, { ...x, updatedAt: minutesAgo(ages[id]?.[0] ?? 1), lastRequestAt: minutesAgo(ages[id]?.[1] ?? 1) }]),
  ),
}));
const m = (contextPct: number, totalTokens: number, costUsd: number, hot = false) => ({
  contextTokens: contextPct * 2000, contextAt: Date.now(), totalTokens, costUsd, tokensPerMin: hot ? 180_000 : 20_000, hot, updatedAt: Date.now(),
});
useMetrics.setState({
  byPane: { p1: m(38, 412_000, 1.84), p2: m(57, 903_000, 3.12), p3: m(22, 188_000, 0.71), p4: m(88, 2_410_000, 7.9, true), p5: m(31, 260_000, 0.95), p8: m(9, 41_000, 0.12) },
});

// Threads are named after their first prompt; p2 is working toward a goal.
for (const [id, title] of Object.entries({
  p1: "Backfill org_id for existing users",
  p3: "Rewrite the quickstart for the new CLI flags",
  p4: "Add idempotency keys to refunds",
  p5: "Move buckets to eu-west-2",
  p6: "Fix the flaky focus test",
  p7: "Bump vite to the next minor",
  p8: "Retry failed webhooks with backoff",
})) useLayout.getState().updatePane(id, { title });
useLayout.getState().updatePane("p2", {
  goal: {
    text: "Settings nav passes the keyboard test suite",
    check: "npm test -- settings-nav",
    maxRounds: 6,
    startedAt: Date.now() - 20 * 60_000,
    deadline: Date.now() + 2 * 3600_000,
    rounds: 1,
    last: { met: false, code: 1, at: Date.now() - 4 * 60_000, tail: "3 of 11 failing" },
  },
});
if (view === "board") useUi.setState({ mode: "agents" });
if (view === "work") useUi.setState({ mode: "work" });
if (view === "review") {
  // A council has already run on this diff, and Explain is open, so the shot shows both.
  const { mergeCouncil, parseReport } = await import("../../src/lib/council.ts");
  const { saveCouncil } = await import("../../src/store/reviews.ts");
  const reports = [parseReport("Correctness: FAIL - focus can escape the nav\n- [important] src/components/ChatPane.tsx:41 - Escape closes the picker but focus is lost to <body>\n- [nit] src/lib/gitDialog.ts:12 - `msg` could be named `summary`\n- [pre-existing] src/lib/new-helper.ts:3 - this helper never handled an empty list\nSCORE: 7/10\nVERDICT: fix", "deepseek#0"), parseReport("- [important] src/components/ChatPane.tsx:43 - after Escape the focused element is removed, so keyboard users lose their place\n- [important] src/lib/gitDialog.ts:30 - the commit message isn't trimmed before the empty check\nSCORE: 8/10\nVERDICT: fix", "kimi#1")];
  saveCouncil(dev("web"), {
    council: mergeCouncil(reports),
    seats: [{ model: "opencode-go/deepseek-v4.1-flash", seconds: 74, failed: false, score: 7 }, { model: "opencode-go/kimi-k2", seconds: 81, failed: false, score: 8 }],
    at: Date.now(),
    stat: DIFFSTAT.web,
  });
  useUi.setState({ reviewOpen: true });
  const clickExplain = (tries: number) => {
    const b = [...document.querySelectorAll<HTMLButtonElement>(".review-page .page-head button")].find((x) => x.textContent === "Explain");
    if (b && !b.disabled) b.click();
    else if (tries > 0) setTimeout(() => clickExplain(tries - 1), 200);
  };
  clickExplain(20);
}
if (view === "weekly") useUi.setState({ weeklyOpen: true });
if (view === "roadmap") useUi.setState({ roadmapOpen: true, roadmapProject: params.get("project") });
if (view === "settings") useUi.setState({ settingsOpen: true, settingsSection: params.get("section") });
if (params.get("queue")) useUi.setState((s) => ({ prefs: { ...s.prefs, mergeQueue: true } }));
// view=threads&greet=1: the title-bar wordmark plays its hourly greeting a moment after load.
if (params.get("greet") === "1") setTimeout(() => useUi.setState({ greetingPlayAt: Date.now() }), 800);
if (params.get("nav") === "right") useUi.setState((s) => ({ prefs: { ...s.prefs, navRight: true } }));
if (params.get("overnight") === "1") {
  // view=board&overnight=1: the morning after a nightly review (store/nightly.ts) found one agreed bug.
  useUi.setState((s) => ({ prefs: { ...s.prefs, nightlyReview: true } }));
  const { useNightly } = await import("../../src/store/nightly.ts");
  useNightly.setState({
    lastRun: Date.now() - 5 * 3_600_000,
    byRepo: {
      [dev("payments")]: {
        folder: "src/refunds", at: Date.now() - 5 * 3_600_000, reviewers: 2, score: 6.5,
        findings: [{ tag: "important", file: "src/refunds/retry.ts", line: 48, text: "The retry loop never resets `attempt`, so a second refund on the same order fails at once.", by: ["deepseek", "kimi"] }],
      },
      [dev("api-server")]: {
        folder: "src/auth", at: Date.now() - 5 * 3_600_000, reviewers: 2, score: 9,
        findings: [{ tag: "delete", file: "src/auth/legacyToken.ts", line: 1, text: "`signLegacyToken` has no callers since the session rewrite; the whole file can go.", by: ["deepseek", "kimi"] }],
      },
    },
  });
}
if (view === "threads" && params.get("inbox") === "1") {
  // view=threads&inbox=1: Alerts → Inbox with one of each kind of background work, opened a moment after load.
  const now = Date.now();
  const { useNightly } = await import("../../src/store/nightly.ts");
  const { useTeamRuns } = await import("../../src/store/teamRuns.ts");
  const { useRoutineRuns } = await import("../../src/lib/routines.ts");
  const { useChat } = await import("../../src/lib/chat.ts");
  useNightly.setState({
    running: false,
    byRepo: {
      [dev("payments")]: { folder: "src/refunds", at: now - 5 * 3_600_000, reviewers: 2, findings: [{ tag: "important", file: "src/refunds/retry.ts", line: 48, text: "attempt never resets", by: ["deepseek", "kimi"] }] },
      [dev("api-server")]: { folder: "src/auth", at: now - 5 * 3_600_000, reviewers: 2, findings: [] },
    },
  });
  useTeamRuns.setState({ runs: [{ id: "tr1", teamId: "t1", task: "Port the CSV importer to streams", plan: { lead: "", workers: [] } as never, paneIds: ["p2"], status: "blocked", summary: "The lead needs the new schema before workers can start", createdAt: now - 40 * 60_000 }] });
  useRoutineRuns.setState({ runs: { r1: { at: now - 12 * 60_000, paneId: "p5" } } });
  // The routine's pane is still working (a chat pane's status lives in the chat store).
  if (useChat.getState().byPane.p5) useChat.setState((s) => ({ byPane: { ...s.byPane, p5: { ...s.byPane.p5!, status: "working" } } }));
  else useAgents.setState((s) => ({ sessions: { ...s.sessions, p5: { ...(s.sessions.p5 ?? {}), status: "working" } as never } }));
  const pid = Object.keys(useChat.getState().byPane)[0];
  const chat = pid ? useChat.getState().byPane[pid] : undefined;
  if (chat) {
    const tool = (id: string, input: Record<string, unknown>, result: string | undefined, at: number, isError = false) => ({ kind: "tool" as const, id, toolId: id, name: "mcp__aurelia__aurelia_delegate", input, partial: "", result, isError, steps: 0, at });
    useChat.setState((s) => ({
      byPane: {
        ...s.byPane,
        [pid]: {
          ...chat,
          transcript: {
            ...chat.transcript,
            items: [
              ...chat.transcript.items,
              tool("ib1", { provider: "opencode", task: "Find why the right arrow types boxes in the composer", mode: "work" }, "Named keys were inserted as text; Composer.tsx now ignores them.\n\n---\nDeepSeek agent · opencode-go/deepseek-v4.1-flash · write · 9 tool calls · 48.2s\nChanged: src/components/Composer.tsx", now - 25 * 60_000),
              tool("ib2", { provider: "claude", model: "haiku", task: "Check Notes gets the same key code", wait: false }, 'Started d2: Claude agent on "Check Notes gets the same key code"', now - 3 * 60_000),
              tool("ib3", { provider: "grok", task: "Review the Composer change" }, "Grok CLI isn't signed in", now - 60 * 60_000, true),
            ],
          },
        },
      },
    }));
  }
  setTimeout(() => document.querySelector<HTMLButtonElement>(".notice-bell > button")?.click(), 700);
}
if (view === "palette") useUi.setState({ paletteOpen: true });
if (view === "permissions") useUi.setState({ permissionsOpen: true });
if (view === "files") useUi.setState({ nav: "files" });
if (view === "threads") {
  useUi.setState({ single: params.get("single") === "1", railTab: (params.get("rail") as "queue" | "changes" | "details" | "notes") ?? "queue" });
  useLayout.getState().updatePane("p4", { babysit: true, babysitWakes: 2 });
  useLayout.getState().updatePane("p3", { settled: true });
  useLayout.getState().updatePane("p7", { snoozedUntil: Date.now() + 3_600_000 });
  // p8 finished with a passing check (Ready); p4's diff has grown 4× since it started (tripwire).
  useLayout.getState().updatePane("p8", {
    goal: { text: "Webhook retries pass", check: "npm test -- webhooks", maxRounds: 6, startedAt: Date.now() - 50 * 60_000, deadline: Date.now() + 3600_000, rounds: 2, last: { met: true, code: 0, at: Date.now() - 30 * 60_000, tail: "12 passing" }, ended: { at: Date.now() - 30 * 60_000, why: "met" } },
  });
  const { noteBase } = await import("../../src/store/reviews.ts");
  noteBase("p4", { files: 3, additions: 80, deletions: 12 }, true);
}
if (view === "start") useLayout.getState().activateTab("t3");
if (view === "chatstart") useLayout.getState().activateTab("t4");
if (view !== "terminals" && view !== "files" && view !== "threads") useNotices.getState().clear();
if (view === "chat" && REPLAY) useLayout.getState().activateTab("t4");
if (view === "chat" && !REPLAY) {
  // A chat mid-turn, waiting on an approval, with one message queued behind it.
  const { useChat } = await import("../../src/lib/chat.ts");
  useLayout.getState().activateTab("t4");
  await sleep(900);
  let n = 0;
  const id = () => `i${n++}`;
  useChat.setState({
    byPane: {
      p10: {
        status: "waiting",
        tokens: 14_200,
        costUsd: 0.42,
        model: "claude-opus-5-5",
        queued: [{ text: "also check whether Notes gets the same key code", uuid: "q1" }],
        approvals: [{ id: "a1", tool: "Bash", input: { command: `log show --last 5m --predicate 'subsystem == "com.aurelia.voice"'`, description: "Read Aurelia Voice's key events" }, description: "Reads Aurelia Voice's key events. Changes nothing." }],
        transcript: {
          open: {},
          files: [],
          seq: 9,
          items: [
            { kind: "user", id: id(), text: "Which keyboard layout does the composer assume?", files: ["keymap-spec.pdf", "layouts.csv"], at: Date.now() - 600_000 },
            { kind: "tool", id: id(), toolId: "t0", name: "Read", input: { file_path: "/Users/you/dev/web/src/lib/keys.ts" }, partial: "", result: "...", steps: 0, at: Date.now() - 590_000 },
            { kind: "text", id: id(), text: "None: it reads `KeyboardEvent.key`, so the OS layout decides. The only hard-coded keys are Enter, Escape and the arrows, all layout-independent.", done: true, final: true, at: Date.now() - 548_000 },
            { kind: "turn", id: id(), outcome: "completed", files: [], ms: 52_000, at: Date.now() - 548_000 },
            { kind: "user", id: id(), text: "And the paste handler?", via: "queued", at: Date.now() - 540_000 },
            { kind: "text", id: id(), text: "Same story: it takes `clipboardData.getData(\"text/plain\")` and strips control characters before it reaches the textarea (`cleanTextarea` in `lib/controlChars.ts`).", done: true, final: true, at: Date.now() - 520_000 },
            { kind: "turn", id: id(), outcome: "completed", files: [], ms: 20_000, at: Date.now() - 520_000 },
            { kind: "user", id: id(), text: "Skip the paste path, look at the arrow keys instead.", via: "steered", at: Date.now() - 500_000 },
            { kind: "text", id: id(), text: "Arrow keys go straight to the textarea; nothing in the app listens for them while the composer has focus.", done: true, final: true, at: Date.now() - 480_000 },
            { kind: "turn", id: id(), outcome: "completed", files: [], ms: 20_000, at: Date.now() - 480_000 },
            { kind: "user", id: id(), text: "The composer gets 7 boxes when I press the right arrow instead of moving the caret. Notes did it too. Find out whether it's us." },
            { kind: "tool", id: id(), toolId: "t1", name: "Grep", input: { pattern: "u001d" }, partial: "", result: "No matches", steps: 0 },
            { kind: "tool", id: id(), toolId: "t2", name: "Read", input: { file_path: "/Users/you/dev/web/src/components/Composer.tsx" }, partial: "", result: "...", steps: 0 },
            { kind: "tool", id: id(), toolId: "t2a", name: "Task", input: { description: "Find other key handlers", subagent_type: "scout", model: "haiku", prompt: "Search `src/` for every `keydown` handler that reads `e.key`.\n\n- List each as `file:line`.\n- Say which ones would type a box for the right arrow." }, partial: "", result: "3 handlers: Composer.tsx:212, Palette.tsx:88, Search.tsx:40. Only Composer types a box.", steps: 4, sub: [{ name: "Grep", input: { pattern: "keydown" } }, { name: "Read", input: { file_path: "/Users/you/dev/web/src/components/Composer.tsx" } }] },
            { kind: "text", id: id(), text: "Nothing in the app writes that character, and Notes doing the same thing puts it below us. Two suspects left: the Karabiner \"Right Command to hjkl\" rule and Aurelia Voice's key tap.\n\nThe system log will show which one sends the key. It's read only.", done: true, final: true },
            { kind: "tool", id: id(), toolId: "t3", name: "Bash", input: { command: "log show --last 5m" }, partial: "", steps: 0 },
          ],
        },
      },
    },
  });
  if (params.get("delegate") === "1") {
    // Three delegated agents: one done with edits, one started in the background, one still working.
    const chat = useChat.getState().byPane.p10!;
    const done = `The right-arrow handler in Composer.tsx:212 inserts the key's text when \`key\` is longer than one character; it now ignores named keys.\n\n---\nDeepSeek agent · opencode-go/deepseek-v4.1-flash · write · 9 tool calls · 48.2s · session ses_8f2\nChanged: src/components/Composer.tsx, src/lib/keys.test.ts\nDelegation d1`;
    useChat.setState({
      byPane: {
        p10: {
          ...chat,
          status: "working",
          approvals: [],
          queued: [],
          transcript: {
            ...chat.transcript,
            items: [
              { kind: "user", id: id(), text: "Fix the right-arrow boxes, and have someone check Notes in the background." },
              { kind: "text", id: id(), text: "I'll hand the fix to DeepSeek and the Notes check to Haiku in the background.", done: true },
              { kind: "tool", id: id(), toolId: "d1", name: "mcp__aurelia__aurelia_delegate", input: { provider: "opencode", task: "Find why the right arrow types boxes in the composer and fix it, with a test.", mode: "work" }, partial: "", result: done, steps: 0 },
              { kind: "tool", id: id(), toolId: "d2", name: "mcp__aurelia__aurelia_delegate", input: { provider: "claude", model: "haiku", task: "Check whether Notes gets the same key code from Aurelia Voice's key tap.", wait: false }, partial: "", result: 'Started d2: Claude agent on "Check whether Notes gets the same key code". Check it with aurelia_delegation (status, wait or cancel) and id d2.', steps: 0 },
              { kind: "tool", id: id(), toolId: "d3", name: "mcp__aurelia__aurelia_delegate", input: { provider: "grok", task: "Review the Composer.tsx change for other named keys it might still type." }, partial: "", steps: 0 },
            ],
          },
        },
      },
    });
  }
  if (params.get("browser") === "1") {
    // The agent's browser loop: open, snapshot, click and screenshot, each as its own card.
    const chat = useChat.getState().byPane.p10!;
    useChat.setState({
      byPane: {
        p10: {
          ...chat,
          status: "working",
          approvals: [],
          queued: [],
          transcript: {
            ...chat.transcript,
            items: [
              { kind: "user", id: id(), text: "Open the settings preview and check the save button." },
              { kind: "tool", id: id(), toolId: "b1", name: "mcp__aurelia__aurelia_browser", input: { action: "open", url: "http://localhost:1437/design/preview/?view=settings" }, partial: "", result: JSON.stringify({ pane: "p9", url: "http://localhost:1437/design/preview/?view=settings", title: "Settings · AureliaCode" }), steps: 0 },
              { kind: "tool", id: id(), toolId: "b2", name: "mcp__aurelia__aurelia_browser", input: { action: "snapshot", selector: "main.settings-content" }, partial: "", result: "url: http://localhost:1437/design/preview/?view=settings\ntitle: Settings · AureliaCode\nviewport: 1100x760, scrolled 0/240\n\n- main \"Settings\" [ref=e1]\n  - heading \"General\" [level=2, ref=e2]\n  - button \"Choose…\" [ref=e3]\n  - checkbox \"Open files in AureliaCode\" [checked, ref=e4]\n  - button \"Save\" [ref=e5]", steps: 0 },
              { kind: "tool", id: id(), toolId: "b3", name: "mcp__aurelia__aurelia_browser", input: { action: "act", kind: "click", ref: "e5" }, partial: "", result: JSON.stringify({ ok: true, kind: "click", target: "button#save [ref=e5]", note: "covered by div.toast at its centre; dispatched to the element anyway" }), steps: 0 },
              { kind: "tool", id: id(), toolId: "b4", name: "mcp__aurelia__aurelia_browser", input: { action: "screenshot", ref: "e5" }, partial: "", result: JSON.stringify({ image: "/tmp/aurelia-preview-shot.png", width: 320, height: 88, target: "button#save [ref=e5]" }) + "\n[image]", steps: 0 },
            ],
          },
        },
      },
    });
  }
}
if (view === "chat" && params.get("visual") === "1") {
  // A visual reply: the agent showed a page with aurelia_show_html and the chat draws it as a card.
  const { useChat } = await import("../../src/lib/chat.ts");
  const chat = useChat.getState().byPane.p10!;
  const page = `<!doctype html><html><head><style>
h2{margin:0 0 4px;font-size:15px}p{margin:0 0 12px;color:var(--text-dim)}
.row{display:grid;grid-template-columns:120px 1fr 64px;gap:10px;align-items:center;margin:6px 0;font-size:12.5px}
.bar{height:14px;border-radius:4px;background:var(--accent);transform-origin:left;animation:grow .6s ease-out both}
.bar.up{background:var(--err)}.bar.down{background:var(--ok)}
.num{text-align:right;font-family:var(--font-mono);color:var(--text-dim)}
@keyframes grow{from{transform:scaleX(0)}}
@media (prefers-reduced-motion:reduce){.bar{animation:none}}
</style></head><body>
<h2>Bundle size by chunk</h2><p>main vs this branch, gzipped. <a href="https://vite.dev/guide/build">How Vite splits chunks</a></p>
<div class="row"><span>index</span><div class="bar" style="width:92%"></div><span class="num">184 kB</span></div>
<div class="row"><span>ChatPane</span><div class="bar up" style="width:61%"></div><span class="num">122 kB</span></div>
<div class="row"><span>settings</span><div class="bar down" style="width:34%"></div><span class="num">68 kB</span></div>
<div class="row"><span>markdown</span><div class="bar" style="width:22%"></div><span class="num">44 kB</span></div>
<div class="row"><span>xterm</span><div class="bar" style="width:48%"></div><span class="num">96 kB</span></div>
<script>document.querySelectorAll(".row").forEach(function(r){r.title=r.textContent.trim()})</script>
</body></html>`;
  useChat.setState({
    byPane: {
      p10: {
        ...chat,
        status: "idle",
        approvals: [],
        queued: [],
        transcript: {
          ...chat.transcript,
          items: [
            { kind: "user", id: "v0", text: "Show me which chunks grew on this branch, as a chart.", at: Date.now() - 90_000 },
            { kind: "tool", id: "v1", toolId: "vb", name: "Bash", input: { command: "npm run build -- --report" }, partial: "", result: "built in 4.1s", steps: 0 },
            { kind: "tool", id: "v2", toolId: "vs", name: "mcp__aurelia__aurelia_show_html", input: { title: "Bundle size by chunk", html: page }, partial: "", result: JSON.stringify({ url: "http://127.0.0.1:51234/0123456789abcdef/fedcba9876543210.html", shown: "in the chat, as a card above your reply" }), steps: 0 },
            { kind: "text", id: "v3", text: "ChatPane grew by 9 kB, all from the new card styles; settings shrank after the duplicate sections went. Nothing else moved more than 1 kB.", done: true, final: true, at: Date.now() - 60_000 },
            { kind: "turn", id: "v4", outcome: "completed", files: [], ms: 31_000, at: Date.now() - 60_000 },
          ],
        },
      },
    },
  });
}
if (view === "commit") {
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { GitDialog } = await import("../../src/components/GitDialog.tsx");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;z-index:70;background:var(--bg);";
  document.body.append(host);
  createRoot(host).render(createElement(GitDialog, { mode: "commit", dir: dev("web"), onClose: () => {}, onDone: () => {} }));
}
if (view === "history") {
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { HistoryPanel } = await import("../../src/components/HistoryPanel.tsx");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;z-index:70;background:var(--bg);";
  document.body.append(host);
  createRoot(host).render(createElement(HistoryPanel));
}
if (view === "agentview") {
  useUi.setState({ mode: "agents" });
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { AgentView } = await import("../../src/components/AgentView.tsx");
  const host = document.createElement("div");
  host.className = "agent-view-host";
  host.style.cssText = "position:fixed;inset:0;z-index:70;background:var(--bg);";
  document.body.append(host);
  createRoot(host).render(createElement(AgentView));
}
if (view === "chat" && params.get("opencode") === "1") {
  // An OpenCode chat, drawn from the messages src-tauri/src/opencode_chat.rs makes of its events.
  const { useChat } = await import("../../src/lib/chat.ts");
  const { addUser, applyLine, emptyTranscript, endTurn } = await import("../../src/lib/chatModel.ts");
  const said = (id: string, block: Record<string, unknown>) => ({ type: "assistant", message: { id, role: "assistant", content: [block] } });
  const result = (id: string, content: string, is_error = false) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error }] } });
  const file = dev("web") + "/src/lib/calc.ts";
  let t = addUser(emptyTranscript(), "add(2, 3) returns -1. Fix it and run the tests.", Date.now() - 60_000);
  for (const m of [
    said("m1", { type: "thinking", thinking: "Read calc.ts first, then fix add and run the tests." }),
    said("m1", { type: "tool_use", id: "c1", name: "Read", input: { file_path: file } }),
    result("c1", "export const add = (a: number, b: number) => a - b;"),
    said("m1", { type: "tool_use", id: "c2", name: "Edit", input: { file_path: file, old_string: "a - b", new_string: "a + b" } }),
    result("c2", "Edited calc.ts (1 replacement)"),
    said("m1", { type: "tool_use", id: "c3", name: "Bash", input: { command: "npm test" } }),
    result("c3", "ℹ tests 12\nℹ pass 12\nℹ fail 0"),
    said("m2", { type: "text", text: "`add` subtracted (`a - b`); it now adds. The tests pass: 12 of 12." }),
  ])
    t = applyLine(t, m);
  t = endTurn(t, "completed", null, { inputTokens: 25_613, outputTokens: 133, cacheReadTokens: 768, cacheWriteTokens: 0, costUsd: 0.0039 }, 9_400);
  useLayout.getState().activateTab("t4");
  await sleep(900);
  useChat.setState({ byPane: { p10: { status: "idle", tokens: 26_514, costUsd: 0.0039, model: "opencode-go/deepseek-v4.1-flash", queued: [], approvals: [], transcript: t } } });
}
if (view === "chat" && params.get("attach") === "1") {
  // One chip of each kind, dropped from Finder: image, PDF, text, a path-only file, and one over the cap.
  const { attachToChat } = await import("../../src/lib/chatComposer.ts");
  attachToChat("p10", ["/Users/you/shot.png", "/Users/you/specs/spec.pdf", "/Users/you/data/rows.csv", "/Users/you/Deck.pptx", "/Users/you/big.pdf"]);
  await sleep(400);
}
if (view === "chat" && params.get("untangle") === "1") {
  const { useChat } = await import("../../src/lib/chat.ts");
  const chat = useChat.getState().byPane.p10;
  if (chat) {
    useChat.setState({
      byPane: {
        p10: {
          ...chat,
          commands: [{ name: "untangle-codebase", description: "Untangle a whole codebase in one pass.", argumentHint: "[optional area or concern to focus on]" }],
        },
      },
    });
  }
}
if (view === "chat" && params.get("goal")) {
  // A goal two rounds in, the last check short of its score (&goal=1), or the set-goal dialog (&goal=dialog).
  const now = Date.now();
  useLayout.getState().updatePane("p10", {
    goal: {
      text: "The settings page scores 8/10 or better on the UI rubric",
      check: "npm run ui-score -- settings",
      target: 8,
      maxRounds: 8,
      startedAt: now - 47 * 60_000,
      deadline: now + 3 * 3600_000,
      rounds: 2,
      last: { met: false, code: 0, score: 6.5, tail: "Typography 7/10\nSpacing 6/10\nSCORE: 6.5/10", at: now - 60_000 },
    },
  });
  if (params.get("goal") === "dialog") {
    const { GOAL_OPEN } = await import("../../src/lib/shortcuts.ts");
    await sleep(100);
    window.dispatchEvent(new CustomEvent(GOAL_OPEN, { detail: "p10" }));
  }
  await sleep(200);
}
// Toasts go after 3 s in the app; a screenshot shouldn't freeze one over the header. `&toast=1` keeps it.
if (params.get("toast") !== "1") {
  useUi.setState({ toast: null });
  useUi.subscribe((s) => s.toast && useUi.setState({ toast: null }));
}
if (view === "chat" && params.get("scroll") === "up") {
  // Scrolled back through the conversation, the way a wheel would: the jump-back button shows.
  await sleep(300);
  const log = [...document.querySelectorAll<HTMLElement>(".chat-log")].find((el) => el.clientHeight > 0);
  log?.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, bubbles: true }));
  if (log) log.scrollTop = 0;
  await sleep(100);
}
// Screens load lazily (App.tsx): screenshots wait until their code is in and React has drawn them.
await (await import("../../src/App.tsx")).loadScreens();
await new Promise((r) => setTimeout(r, 50));
// A screen that just mounted is still fading in; finite animations settle first (spinners loop forever).
await Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})));
if (view === "chat" && params.get("untangle") === "1") {
  const { UNTANGLE_OPEN } = await import("../../src/lib/untangle.ts");
  const deadline = Date.now() + 4000;
  while (!document.querySelector("[data-chat-input='p10']") && Date.now() < deadline) await sleep(50);
  window.dispatchEvent(new CustomEvent(UNTANGLE_OPEN, { detail: "p10" }));
  await sleep(250);
}
(window as any).__ready = true;
