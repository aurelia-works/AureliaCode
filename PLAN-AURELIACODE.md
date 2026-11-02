# AureliaCode: phase plan

Decided by Jah, 2026-11-02 (follow-up Q&A):
- AureliaSpace becomes **AureliaCode**. PandaCode, T3 Code and Grok Bot are references only (ideas, no code/assets).
- Terminal UI goes completely. Agents still run shell commands; you see chat, cards and tool results.
- Repo moves `~/Downloads/AureliaSpace` → `~/Downloads/PROJECTS/GITHUB REPOS/AureliaCode`; GitHub `aurelia-works/AureliaSpace` → `aurelia-works/AureliaCode`.
- Squid menubar: account, plan usage, API shadow bill, real API spend, per-provider split, 24h/7d/30d.
- Privacy: keys in Keychain, no telemetry, local-only data, streamer-mode blur on account details (unblur slowly after 3 s hover, or on click).
- Research: `design/AURELIACODE-TEARDOWN.md`.

## Decision: CLIProxyAPI (Jah 2026-11-02)
CLIProxyAPI for the Claude subscription is reported to break Anthropic's consumer terms (ban risk; see teardown). Jah accepts the risk: Phase 2 routes Claude (and the signed-in account) through CLIProxyAPI. Keep it switchable off in settings.

## Phases
Estimates are agent time and rough tokens (from PLAN-T3 actuals: about 60-75 min per UI phase of similar size, ~1-2M tokens incl. cache reads).

| # | Phase | Estimate | Actual | Model | Status |
| --- | --- | --- | --- | --- | --- |
| 0 | Research + plan | 30-45 min | scout 4.7 min, 103k tok; main session not measured | Haiku scout + Opus | done, approved 2026-11-02 |
| 1 | Rename, move, re-sign; terminal out; chat-first window with working select/copy | 2-3 h, ~3-4M tok | | Sonnet 5.5 medium | todo |
| 2 | Squid menubar: account, usage, spend, providers, privacy blur; CLIProxyAPI (Claude routed, risk accepted) | 2-3 h, ~3-4M tok | | Sonnet 5.5 medium | todo |
| 3 | Grok Bot-style features Jah picks from the teardown | 1-3 h (depends on picks) | | Sonnet 5.5 medium | todo |

Phase 1 and 2 are each near the one-thread limit; if one runs long it stops and is marked "part done".

### Phase 1: Rename, move, re-sign, chat-first window
Goal: AureliaCode.app opens on a chat-first window with no terminal anywhere.
- Commit the 47 WIP files on `feat/agent-harness` (git status check first, no build output), push.
- Move the folder, rename the GitHub repo, update remote, fix paths that point at `~/Downloads/AureliaSpace` (scripts, MCP config, hooks, worktrees).
- `productName` AureliaCode, identifier `space.aurelia.terminal` → new id (e.g. `space.aurelia.code`), re-sign; Jah re-grants mic/screen/accessibility once. Migrate app data dir from the old id.
- Remove terminal panes, xterm, `ptyhost` UI paths and terminal tabs; keep the shell runner agents need. Hide anything unsure behind a dev-panel toggle instead of deleting.
- Chat: messages are selectable DOM text; Cmd+A selects the message list, copy works. Failing test first.
- Layout per teardown recommendation.
Done when: AureliaCode.app launches from `/Applications`, no terminal visible, Cmd+A + Cmd+C copies a chat, all Verification gates green, screenshot of `chat` view.
Needs: Phase 0.

### Phase 2: Squid menubar + spend + privacy
Goal: the squid tray icon shows who you are and what you've used.
- Tauri tray + popover (template squid icon, light/dark; colour/size/animation on dev panel).
- Plan usage from existing `usage.rs` (5h/7d, reset times), per account.
- API shadow bill: local ledger over `~/.claude/projects/*.jsonl` (+ Codex sessions), live list prices, cache file, 24h/7d/30d, split by provider.
- Real API spend: from keys Jah adds (Keychain); Anthropic needs an Admin API key, else shows "not available".
- Privacy: Keychain for all keys, telemetry off (app + CLIProxyAPI), no outbound calls except vendor usage/price routes, streamer blur.
- CLIProxyAPI: `brew install cliproxyapi`, local hub on 127.0.0.1:8317, Claude + signed-in account routed through it, telemetry off, on/off switch in settings.
Done when: tray popover screenshot with real numbers and blur working; unit tests for ledger windows and pricing.
Needs: Phase 1 (new bundle id).

### Phase 3: Grok Bot-style features
Goal: the fun features Jah picks. Candidates (teardown): agent roster faces in the menubar, squid companion panel reacting to agent activity, presence park (hold agents when away), per-agent avatars, realtime voice, loop detection. Each behind a dev-panel toggle.
Done when: decided at the start of the phase from Jah's picks.
Needs: Phase 2 (tray).
