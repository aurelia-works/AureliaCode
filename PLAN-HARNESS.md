# AureliaSpace as an agent harness: review and next steps

Written 2026-11-01. This is a product/architecture review, not a commit plan.
It looks at AureliaSpace against BridgeMind, T3 Code, the Codex app/CLI, Claude Code
and PandaCode, and proposes the next build sequence.

## Implementation status (2026-11-01)

P0–P6 are implemented in this working tree. The gates are green, and the independent
review's findings are fixed or retired. Bounded pieces:

- **P1 Codex:** the Codex **chat** path was removed because this machine has no Codex
  subscription. Codex remains a terminal harness in the launcher and team router. The
  `harness` seam and the app-server adapter are gone rather than left as dead code.
- **P2 Work:** the board, durable store, file-selected commit dialog, PR dialog and
  worktree merge are in. Commit paths are literal (glob-safe) and handle deletions and
  renames; a failed push is reported as a failure. Cards still move by drag only; tasks
  added in the old rail after the one-time migration do not sync live.
- **P3 Teams:** router, team planner, run launcher, Agent view and the `aurelia_task_*` /
  `aurelia_team_finish` tools are in. `team_finish` is restricted to a pane in the run;
  a watcher closes runs whose panes are gone or idle for 15 minutes with a blocked note.
  Routed models are enforced for Claude chat workers; terminal harnesses keep their own
  CLI model.
- **P4 Skills:** the GITHUB REPOS pack is discovered, ds-swarm is pinned first, and the
  home route can run a skill through OpenCode. Roots are editable in Settings → Skills
  and persist in `skills.json`; scans cap at six concurrent reads.
- **P5 Browser:** element picking and screenshot capture are in. The screenshot now
  converts the webview's logical bounds and the window's content origin into global
  screen points. The live WKWebView pick path was not exercised in the preview harness.
- **P6 Store/remote:** SQLite threads/events, the health panel, and "keep running when
  the window closes" are in. Thread history is searchable (⇧⌘Y). Auto-update is still a
  manual releases link, not the Tauri updater.

## Method

- Read the app, its plans (`PLAN.md`, `PLAN-T3.md`, `CHAT-PLAN.md`), README, DESIGN.md
  and the Rust/TypeScript seams that matter (chat, pty, control, remote, tasks, layout).
- Ran the current gates: `npx tsc --noEmit` (clean), `npm test` (150 pass),
  `cargo test` (82 pass, 4 ignored), `npm run build` (built in 283 ms), and
  `npm run app:build:dev` (Finished 1 bundle, 46.13 MiB debug app).
- Looked at the live previews (`threads`, `chat`, `start`, `board`, `settings`) at
  `design/preview/`.
- Used Playwright against BridgeMind's interactive demo and docs, T3 Code's site,
  PandaCode's repo, and the Claude Code/Codex documentation.
- Used REA on the installed PandaCode binary: `wry 0.55.1` + AppKit + WebKit,
  arm64, 27.9 MB, hardened runtime, no bundled Chromium. AureliaSpace's installed
  app is 9.8 MB, so size/performance is already a strength.

## The short version

AureliaSpace already has the hard local parts most competitors spent months building:
PTYs that survive restarts, multiple Claude accounts, Claude Code hooks, permission
scraping, worktrees, checkpoints, diff review, usage forecasting, a phone remote,
dictation, a HUD, and a planner that none of the five competitors have.

What it does not have is the **control plane** layer they all converge on:

1. **One harness interface, several harnesses.** Chat is Claude-only. Codex is a
   terminal pane. T3 Code, PandaCode and BridgeMind all drive multiple harnesses
   through one thread UI.
2. **A durable work graph.** Threads are panes; closing one keeps it only in an
   in-memory undo stack. Tasks, roadmap cards, worktrees and PRs are separate objects.
   Codex, T3 and PandaCode all make a thread/task the durable unit.
3. **Real orchestration.** AureliaSpace can launch a team of panes and has a DeepSeek
   subagent MCP, but there is no lead/worker task list, no model routing, no
   escalation, and no single "agent view" over native background sessions.
4. **A verification loop.** The browser pane shows a page; it cannot pick an element,
   capture console/network, or attach evidence to a thread. PandaCode and the Codex /
   Claude desktop apps close that loop.
5. **Durable state.** JSON files are fine for config. They are not a good store for
   threads, events and transcripts. PandaCode and T3 use SQLite.

The next step is not "add more panes". It is to make **the thread the product**, with
the pane as one view of it, and to connect the work graph end to end:
goal → roadmap card → task → thread → worktree → diff → PR → review → weekly review.

## What each product is actually selling

| Product | The mechanism worth taking | What not to copy |
| --- | --- | --- |
| **BridgeMind** | Three surfaces over one engine: Agent (persistent teammate with brief, memory, skills, places), Code (workspace panes: terminal/thread/files/browser/simulator), Thread (conversation). Agent-to-agent messaging, routines, presets (Solo/Pair/Workbench/Swarm), account handoff. | Credits, subscription tiers, cloud dictation, BridgeVerse 3D, community/marketing. |
| **T3 Code** | An open-source control plane: one thread can mix Claude/Codex/Muse/Gemini subagents; switch models mid-thread; every thread gets a branch and a one-button commit/push/PR; web, desktop and native mobile over one server; remote VM without Tailscale (T3 Connect). | Native mobile before the web remote is solid; Electron weight; their server/provider layer wholesale. |
| **Codex app/CLI** | `codex app-server` as a JSON-RPC control surface: `thread/start`, `thread/resume`, `turn/start`, `turn/steer`, `thread/queue`, `thread/fork`, `thread/archive`, `thread/goal/set`, `account/rateLimits/read`, `model/list`, `skills/list`, `review/start`. The app adds worktrees, diff review, skills, automations, terminal, browser, memory, plugins, PR review. | Reimplementing the agent runtime; their cloud/sandbox breadth; OpenAI-specific auth. |
| **Claude Code** | The CLI is already the engine. New native surfaces: `claude agents --json` / `--bg` background sessions, `attach`/`logs`/`rm`/`respawn`, `--remote-control`, agent teams (interactive only), subagents, skills/plugins, worktrees, checkpoints. The desktop app adds panes (chat, diff, browser, terminal, file, plan, tasks, subagent), side chats, PR monitoring. | Agent teams in `-p` mode (they do not spawn there); reimplementing Claude's terminal UI; cloud-only workflows. |
| **PandaCode** | Tauri 2 + Rust + SQLite + plain TypeScript, 27.9 MB. Task board (Pending → In progress → Review → Completed), architect + up to 3 workers with mixed harnesses/models, local model routing, worktrees with one-click merge, approvals bar, find in thread, turn diffs, browser element picker + screenshot, usage per harness, quick overlay. | Bots, VMs, cloud sandboxes, simulators, deploys — breadth that would dilute a personal harness. |

The convergence is clear: **harness abstraction + durable work graph + orchestration +
verification + remote**. AureliaSpace is strongest on the local substrate and weakest on
the first three.

## Where AureliaSpace already wins

- **Local-first and light.** 9.8 MB app, Tauri 2 + Rust + WKWebView, no bundled Chromium,
  no account, no telemetry. PandaCode is the only competitor in the same weight class.
- **Real terminals.** PTY host survives app restarts; command blocks; shell integration;
  alt-screen apps; 16-pane grids. Most chat-first competitors treat the terminal as a
  fallback; AureliaSpace treats it as a first-class pane.
- **Claude Code depth.** Accounts via `CLAUDE_CONFIG_DIR`, hooks, permission dialogs,
  checkpoints, rewind, fork, output styles, effort, usage and cost, context fill,
  handoff, cache badge, auto effort. This is deeper than BridgeMind/T3/PandaCode.
- **Planner.** Today goals, roadmap, habits, focus, signals, weekly review, journal,
  scratchpad. None of the five has this. It is the natural "why" layer above the work.
- **Remote + HUD + voice.** Tailscale pairing per device, phone remote, always-on-top HUD,
  dictation. T3 is the only one with comparable remote; BridgeMind's dictation is cloud.
- **Safety.** Per-device remote tokens, constant-time compare, origin checks,
  Tailscale/LAN allowlist, Keychain-only secrets, worktree dirty checks, checkpoint
  restore. This is a good base to build on.

## Gap map

Sequence: **P0** land, **P1** harness, **P2** work graph, **P3** orchestration,
**P4** teammates, **P5** verification, **P6** durability/remote.

| Capability | Today | Reference | Sequence |
| --- | --- | --- | --- |
| Codex chat (streaming, approvals, queue/steer, resume) | Removed: no Codex subscription; Codex stays terminal-only | T3, BridgeMind, Codex app, PandaCode | **P1 paused** |
| Harness abstraction / provider health | Claude-only chat; `which` only | T3, PandaCode, BridgeMind | **P1** |
| Durable thread store (closed threads, history, search) | Pane meta + in-memory undo stack (20 groups) | T3, Codex, PandaCode | **P2** |
| Work board (Pending/In progress/Review/Done) across projects | Per-project todo/doing/done in the rail | PandaCode, Codex, T3 | **P2** |
| Commit / push / create PR / merge worktree | Read-only diffs + PR badges | T3, Codex, PandaCode | **P2** |
| Agent teams + shared task list + model routing | Launch multiple panes; DeepSeek MCP | PandaCode, Codex, Claude Code | **P3** |
| Agent view over native background sessions | Own pane list only | Claude Code, Codex | **P3** |
| Persistent agent memory / places / skills UI | Instructions only | BridgeMind, Codex | **P4** |
| Browser element picker / screenshot / console | URL bar + webview | PandaCode, Codex, Claude desktop | **P5** |
| SQLite for threads/events/transcripts | JSON files | PandaCode, T3 | **P6** |
| Headless serve + PWA/push + handoff | Window-bound remote | T3, Codex | **P6** |
| Editable keybindings | Read-only shortcut list | T3, PandaCode | **P6** |
| Auto-update / diagnostics / CLI updates | None | PandaCode, T3, Codex | **P6** |

## One principle: integrate the native daemons

The five products are converging on the same architecture: a long-lived local
**session host** plus thin clients. Claude Code and Codex now ship that host
themselves:

- Claude Code: `claude --bg` starts a background session; `claude agents --json`
  lists active sessions; `attach`, `logs`, `rm`, `respawn` manage them;
  `--remote-control` exposes an interactive session to the phone app.
- Codex: `codex app-server daemon start` runs a durable app-server;
  `codex app-server --listen ws://…` / `--remote` connects clients; the protocol has
  `thread/start`, `turn/steer`, `thread/queue`, `thread/fork`, `thread/archive`,
  `account/rateLimits/read`, `skills/list`, `review/start`.
- AureliaSpace already has `pty-host` for terminals, which survives app restarts.

The cheapest path to T3/Codex parity is therefore **not** to write a new agent runtime.
It is to make AureliaSpace a first-class client of these daemons, and to own only what
they do not provide: the work graph, the board, the planner, the cross-harness routing,
and the UI. Build a session host of your own only for the gaps (for example, terminal
harnesses without a daemon, or a unified event log for search).

## What it should feel like

Keep the existing design thesis: gold means "you're needed", everything else is quiet.
But change the unit from the pane to the **thread**:

- **Work** — the board and the queue: what is pending, what is running, what needs review.
- **Threads** — the conversation, diff, browser and terminal for one unit of work.
- **Planner** — the why: goals, roadmap, habits, weekly review.

A pane is one view of a thread. A terminal is one view of a harness. A worktree is one
view of a thread's isolation. The same thread can be opened as chat, terminal, diff,
browser or PR without changing identity. That is the model T3, Codex, PandaCode and
BridgeMind all converge on, and it is the model AureliaSpace's current pane-centric
`PaneMeta` does not yet express.

## The build sequence

### P0 — Land the branch before building on it

The current `feat/linkra-fold` working tree has the T3 phases 1–6 and the remote
pairing/Tailscale work uncommitted (~1,200 lines in tracked files plus 20 untracked
files). Fix the review findings below, run every gate, take the preview screenshots,
then commit in small, reviewable commits and update `PLAN-T3.md` statuses.

**Fix before committing (from the independent review):**

1. **Tailscale HTTPS failure leaves no route in.** `remote.rs:739` binds to loopback
   when `tailscaleHttps && !allowLan`, and `remote.rs:661` drops every HTTP link in that
   mode. If `tailscale serve` fails (certs off, port conflict), `links`/`qrSvg` are empty
   and the UI wrongly says Tailscale isn't ready (`RemoteSection.tsx:163`,
   `remote.rs:822`). Fall back to HTTP/Tailscale-IP links (and a clear Serve error), or
   offer "Use HTTP instead".
2. **Pairing tokens can be lost or briefly world-readable.** `pairing.rs:153-160` writes
   non-atomically with `fs::write` then chmods to 0600; a crash can truncate the file,
   and `load()` at `pairing.rs:142-143` silently resets to no devices. Use the atomic
   `write_json` pattern from `config.rs:411-419`, create with 0600, and keep a corrupt
   backup instead of unpairing every phone.
3. **Bulk Close can't be retried.** `ProjectsSidebar.tsx:558-559` ignores
   `closePanesSafely`'s false return and clears the selection, so the "close again to
   discard" guard cannot fire. Keep the selection when the guard refuses.
4. **Stashing ignores images.** `ChatPane.tsx:1171-1177` passes only `text` to
   `toggleStash`; with an image and no text, ⌘S restores an unrelated draft and leaves
   the image attached. Stash images too, or refuse to stash while images are attached.
5. **⌘[ / ⌘] (back/forward) are stolen from editor panes.** `shortcuts.ts:154-157` captures them in the
   window handler and `shortcuts.ts:226-227` prevents default; the editor escape hatch
   at `shortcuts.ts:119` doesn't list them. Add `BracketLeft`/`BracketRight` to the
   editor exception.
6. **Reopened chats lose the output style.** `closed.ts:23` omits `chatStyle` and
   `babysitWakes` from `CARRY_KEYS`; `copyPromptLink.ts:13` has no rejection handler.
   Add the keys and use the `copyText` pattern.

**Done when:** the tree is clean, `tsc`/`npm test`/`cargo test`/`npm run build` pass, and
the app build passes if Rust/Tauri changed.

### P1 — One harness interface, Claude first

> **Update:** the Codex chat adapter was removed after the owner confirmed there is no
> Codex subscription. Codex remains a terminal harness. The next adapter should be a
> harness the owner actually uses (Claude now, OpenCode/DeepSeek next), not Codex.

Split `src-tauri/src/chat.rs` into a small harness interface and adapters:

```
src-tauri/src/harness/mod.rs      // trait Harness: spawn, send, interrupt, approve, configure, usage
src-tauri/src/harness/claude.rs   // the existing stream-json protocol
src-tauri/src/harness/opencode.rs // next: the DeepSeek/OpenCode chat adapter
```

Codex adapter, minimum viable:
- spawn `codex app-server` (or connect to the daemon) and initialize;
- `thread/start` / `thread/resume` / `turn/start` / `turn/steer` / `turn/interrupt`;
- map `turn/*` and approval requests (`CommandExecutionRequestApproval`,
  `FileChangeRequestApproval`, `PermissionsRequestApproval`, `ToolRequestUserInput`) to
  the existing `Approval` UI;
- read `account/rateLimits/read`, `model/list`, `skills/list`;
- store the thread id in a generic `PaneMeta.session` (keep `claudeSession` as an alias
  during migration).

Keep the Rust side thin: it owns process/transport, JSON-RPC request/response, approval
round-trips and the facts other features need (session id, status, usage, turn end). Put
the transcript mapping in TypeScript (`src/lib/harness/codexModel.ts`) so it can be tested
with `node --test` on recorded JSON-RPC lines, exactly as `chatModel.test.ts` tests Claude
lines today.

Frontend:
- `PaneMeta.harness?: "claude" | "codex"` (default `"claude"` for old layouts);
- `ChatPane` gets its model/effort/permission choices from a provider capability object,
  not from Claude-specific lists;
- Settings → Providers: installed/version/auth status, default model/effort, update hint;
- usage strip shows Codex 5h/7d next to Claude's.

**Why first:** it is the single biggest gap against T3, BridgeMind, Codex and PandaCode,
and it turns every later feature (teams, routing, board) from Claude-only into
harness-neutral. Note that `CHAT-PLAN.md` removed Codex chat because there was no
Codex/ChatGPT subscription; that is no longer true here — `codex login status` reports
"Logged in using ChatGPT" and the installed CLI is 0.159.2 with app-server. Even if you
rarely use Codex, it is the cheapest second harness to prove the abstraction.

**Risk:** `codex app-server` is experimental. Pin the installed version, feature-detect
with `codex --version` and the generated schema, and keep the terminal fallback. Timebox
the protocol spike to one day before committing to the full UI.

**Done when:** a Codex chat streams a turn, approves a command, resumes after restart,
queues/steers, forks, and shows tokens/context; protocol translation has tests; a
screenshot shows Claude and Codex chats side by side.

### P2 — Make the thread durable, then build the work board

Introduce a `Thread` record that outlives a pane:

```ts
interface Thread {
  id: string;
  title: string;
  projectId: string | null;
  cwd: string;
  harness: "claude" | "codex" | ...;
  sessionId?: string;
  status: "pending" | "working" | "review" | "done" | "settled";
  worktree?: { path: string; branch: string };
  taskId?: string;
  cardId?: string;
  pr?: { number: number; url: string; state: string };
  createdAt: number;
  updatedAt: number;
}
```

- Persist open and closed threads (replace the in-memory `closed.ts` stack; keep undo).
- Extend `Task` rather than inventing a parallel object: add `threadId`, `harness`,
  `model`, `worktree`, `branch`, `pr`, `cardId`, `goalId`, `updatedAt`, and a `review`
  status. Keep `projects` keyed by repo root so the existing rail keeps working.
- Add a global **Work** board: Pending → In progress → Review → Done, across projects,
  with harness/model badges, linked thread, linked PR, and drag between columns.
- "Start" from a card/task opens a thread with harness/model/effort and optional worktree.
- "Review" opens the turn/branch diff; "Done" settles the thread and ships the card.
- The board is a projection, not a second source of truth: thread state and task state
  are updated by the same transitions (start, turn end, PR merge, settle, undo).
- Add Git commands: commit, push, create PR (draft/stack/amend), merge worktree with
  dirty/conflict checks, cleanup. Use the existing `gh` auth and `git` shell-outs.
- Add transcript/thread search (SQLite FTS5 when the store lands).

**Why:** this is the difference between a pane manager and a control plane. It also gives
the planner a real object to point at: a goal can become a task, a task a thread, a
thread a PR.

**Done when:** a task goes board → thread → worktree → diff → commit/push → PR → merged →
card shipped without opening a terminal; state transitions have tests; screenshots of
the board and the PR/merge states.

### P3 — Orchestration: teams, routing, agent view

- **Teams with roles.** Reuse `customAgents`/`AgentTeam`, but add a lead and workers,
  a shared task list, a mailbox, max concurrency, and per-worker harness/model/effort.
  Extend the existing `aurelia_*` MCP tools (`aurelia_list_panes`, `aurelia_send_to_pane`,
  `aurelia_open_pane`) with `aurelia_task_*` and `aurelia_message_*` instead of starting a
  second orchestration layer. Use Claude Code subagents/agent teams where they work; for
  Codex, use separate `thread/start` sessions and `turn/steer`; for terminal-only
  harnesses, panes + MCP.
- **Local router.** A pure-TS/ Rust function picks a worker model from task type, cost
  and recent failures (no network). Escalate a failed worker to a stronger model once;
  cap retries.
- **Agent view.** One screen over every live session: AureliaSpace panes plus
  `claude agents --json` and Codex `thread/list`; show state, last action, needs-you,
  attach/logs/stop/rm. Integrate native background agents instead of duplicating them.
- **Side chat.** A read-only question against the current thread's context without
  derailing it (T3 and Claude desktop both have this). Cheap, high value.
- **Automations, not just routines.** Keep the current scheduled prompt, but add the
  Codex model: a standalone run starts a fresh thread in its own worktree and lands in
  the board's Review column; a thread automation wakes the same thread with its context
  intact. Add run history with read/archive.

**Done when:** an architect splits a task into three workers on different harnesses,
each in its own worktree, with a shared task list; a failed worker escalates; one summary
lands; tests cover caps/routing; a screenshot shows the team run.

### P4 — Persistent teammates: memory, places, skills

- Per-agent profile: name, brief, default harness/model, allowed folders (places),
  memory file, skills, routines, messaging permission.
- Memory: append-only notes with timestamps, inspect/edit/delete, a budget, no secrets.
  A "reflect" step after a settled thread writes durable facts.
- Skills: list installed Claude/Codex skills, enable/disable per agent, create from a
  template. No marketplace yet.
- Agent messaging: bounded messages between approved agents, wake an idle agent into a
  fresh chat, audit log and rate limits (BridgeMind's "Bridge" idea, without the cloud).

**Why:** this turns named panes into teammates and makes routines/teams actually useful.
It is also the cheapest way to get most of BridgeMind's Agent mode without its cloud.

### P5 — Browser verification loop

- Element picker: click an element, attach selector + DOM snippet + screenshot to the
  composer.
- Screenshot the current page; capture console errors and network failures.
- Localhost discovery and device presets; "Verify" action that tells the agent to open
  the URL, run the check, and attach evidence.
- Inject through the existing child webview; keep external pages IPC-free and sanitize
  everything that crosses into the app.

**Done when:** select a broken button in a local app, attach it to a thread, the agent
fixes it, and the screenshot evidence lands in the thread; tests cover injection and
sanitization.

### P6 — Durable state, updates, remote

- SQLite (WAL) for threads, work items, events, transcripts, usage samples, closed
  history; keep JSON for config and export. Migrate from existing JSON with a backup.
- Tauri updater, signed builds, provider CLI update checks, a diagnostics/doctor screen.
- Headless `aurelia-space serve`: agents keep running when the window closes; PWA
  install + push; session handoff between Macs over Tailscale. Native mobile only if the
  PWA proves insufficient.
- Today the phone remote is **terminal-only**: `remote.rs` writes through
  `pty::write_to`, and chat panes have no PTY. Extend the remote to chat threads and work
  items before calling it T3 parity. If Claude/Codex native daemons are adopted, the
  remote can attach to those instead of reimplementing their protocols.

## What not to build

- **Credits/billing/subscriptions.** AureliaSpace is personal and bring-your-own.
- **Cloud sandboxes, VMs, bots, deploys, iOS/Android simulators.** PandaCode's breadth is
  impressive but it is a different product. Add one remote host before adding ten
  providers.
- **A native mobile app before the PWA/remote is solid.** T3's mobile app is a moat, but
  it sits on a server that already works.
- **A plugin marketplace.** Support installed skills/plugins first; a catalog can wait.
- **A second agent runtime.** Use Claude Code, Codex app-server, and the installed CLIs.
  AureliaSpace's value is the control surface and the work graph.

## Immediate next actions

1. Fix the review findings on the current branch; commit P0.
2. Spike `codex app-server`: initialize, start a thread, stream one turn, approve one
   command. Measure how stable the protocol feels.
3. If the spike holds, build P1 behind a `harness` flag with Claude as the default.
4. In parallel, write the `Thread` schema and the migration from `PaneMeta`; do not build
   the board on pane state.
5. After P1 and P2, run one real week of work through the board and measure: time to
   review, time to merge, number of terminal detours. Let that decide P3 vs P5.

### First week, concretely

| Day | Work | Proof |
| --- | --- | --- |
| 1 | Fix review findings, run all gates, commit P0 in 3–5 commits. | Clean tree, green gates, screenshots. |
| 2 | `codex app-server` spike: initialize, `thread/start`, one turn, one approval. | A recorded JSON-RPC transcript and a one-page note on protocol gaps. |
| 3–4 | Extract the harness interface; add `PaneMeta.harness` and a Codex transcript mapper. | Claude still passes its 150 tests; Codex mapper has recorded-line tests. |
| 5 | Codex chat in the UI: stream, approve, resume, queue/steer. | Screenshot of Claude and Codex chats side by side. |
| 6–7 | `Thread` schema + Work board skeleton (read-only projection first). | Board screenshot from real threads; no second source of truth. |

## Review findings

The independent review of the uncommitted diff found **6 issues** (3 bugs, 2 risks,
1 cleanup), all fixable before P0 lands:

| # | Severity | Where | What |
| --- | --- | --- | --- |
| 1 | bug | `remote.rs:739`, `remote.rs:661`, `RemoteSection.tsx:163` | Tailscale HTTPS failure leaves no phone route and a misleading "Tailscale isn't ready" message. |
| 2 | risk | `pairing.rs:153-160`, `pairing.rs:142-143` | Non-atomic 0644 write of per-phone tokens; a crash can unpair every phone. |
| 3 | bug | `ProjectsSidebar.tsx:558-559` | Bulk Close clears the selection even when the unsaved-edits guard refuses. |
| 4 | bug | `ChatPane.tsx:1171-1177`, `stash.ts:20` | Stashing ignores attached images and can restore an unrelated draft. |
| 5 | risk | `shortcuts.ts:154-157`, `shortcuts.ts:119` | ⌘[ / ⌘] override the editor pane's own bindings. |
| 6 | cleanup | `closed.ts:23`, `copyPromptLink.ts:13` | Reopened chats lose `chatStyle`/`babysitWakes`; prompt-link copy fails silently. |

What looks solid: one-shot constant-time pairing (`pairing.rs:41-43,83-92`), revocation
closing live sockets (`remote.rs:416-427`), Origin/Host check (`remote.rs:355`), scratch
name validation (`files.rs:164-171`), UUID-gated resume (`reopen.ts:15`), double-reopen
guard (`reopen.ts:38-44`), `undoShip` scoping (`plannerRoadmap.ts:70-95`), panic hook
composition (`panic_log.rs:37-60`), and matching IPC names/args. All gates pass.

The review did not exercise drag-and-drop or the new Settings screens in the preview
harness; do that during P0.
