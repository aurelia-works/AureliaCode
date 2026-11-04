# AureliaCode agent IDE: handoff after Phase 0 (2026-11-04)

## Built
Nothing in code. Phase 0 was the audit and plan: `PLAN-AGENT-IDE.md` (gap table with file:line evidence, 8 phases, estimates).

## Decisions (Jah, check-in page 2026-11-04)
- Plan and order approved as written.
- No Codex: delegation and chat targets are OpenCode Go (DeepSeek and other OpenCode models), Gemini, Claude.
- Phase 2 menubar/ledger WIP committed on `feat/agent-harness` before Phase 1 (see git log).
- Bundle id stays `space.aurelia.code`. `PLAN-AURELIACODE.md` beats `CHAT-PLAN.md`: terminal UI goes.
- Check-in page: https://claude.ai/artifact/MppVmMssihCGMsHZEb3i8A (reuse it for this project).

## Files touched
`PLAN-AGENT-IDE.md` (new), `CLAUDE.md` (Current project pointer), this file.

## Where Phase 1 starts: browser loop for agents
Read only: `PLAN-AGENT-IDE.md` §1, then
- `src-tauri/src/browser.rs` (`browser_eval` at :143 returns `()`; screenshot at :151 is `screencapture -R`)
- `src-tauri/src/control.rs` (control socket `request`, `control_reply` :119-190), `src-tauri/src/orchestrator.rs` (tool list :16-150, `call` :158)
- `src/lib/browser.ts`, `src/lib/browserPick.ts`, `src/components/BrowserPane.tsx` (how the front end drives the pane and gets pick results back)
- T3 source first: `github.com/pingdotgg/t3code/tree/main/apps/server/src/mcp/toolkits/preview` (ideas only, MIT, no copied code).
Plan: give `browser_eval` a result path back over the control socket with a request id; one MCP tool `aurelia_browser` with actions open / snapshot / act / wait / resize / inspect / screenshot; screenshot via WKWebView `takeSnapshot`.
Done when: in the Dev app a Claude chat snapshots `design/preview/?view=chat`, clicks an element by ref, returns a screenshot of the pane alone; cargo tests for the schema and result round-trip.

## Known faults carried over
See `HANDOFF.md` (Phase 2): real API spend needs Jah's Admin keys; CLIProxyAPI sign-in untested; `/Applications` still has the old app.

## Test setup
Real-app testing recipe (temp HOME, Dev Test.app copy, CGEvent helpers in `/tmp/ac2`) is in `HANDOFF-2026-11-02-PHASE-1.md` and `HANDOFF.md`. Port 1437 may be taken; vite on 1441.
