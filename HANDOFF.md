# AureliaCode agent IDE: handoff after Phase 1 (2026-11-04)

Branch `feat/agent-harness`, uncommitted (not committed or pushed; Jah's call).

## Built: `aurelia_browser` (browser loop for agents)
- `src-tauri/src/browser_agent.rs` (new): Tauri command `browser_agent(pane, action, args)`. Talks to the pane's WKWebView directly:
  `callAsyncJavaScript` in WebKit's client content world (page scripts can't see or patch it; promises awaited), `takeSnapshot` for screenshots (page alone, 1 px per point), frame + `pageZoom` for `resize`. Waits for the expected URL / page load before acting; `open` retries when the first document is replaced mid-call.
- `src-tauri/src/browser_agent.js` (new): snapshot (role tree, refs `e1..` stable until navigation, 20 KB cap, open shadow roots, hidden/closed-details skipped), act (click/type/press/hover/select/scroll), wait (selector/text/gone/idle, ≤15 s), inspect (box, visible, coveredBy, clippedBy, overflow, effective bg, key styles), rect (screenshot crop).
- `orchestrator.rs`: tool `aurelia_browser` (actions open, snapshot, act, wait, resize, inspect, screenshot); `content()` sends a screenshot as an MCP image block plus the path.
- `browser.rs`: shared `label`/`prune_snaps`/`place`; load state from `on_page_load` and navigate/open; emulated viewport applied on every bounds change.
- `src/lib/control.ts`: `browser` method picks the pane (named, else the caller's tab, else the only one) and passes the URL the pane should be on.
- `control.rs`: reply timeout 20 s → 30 s (wait 15 s after a load). `Cargo.toml`: block2/objc2-foundation/app-kit/core-foundation/web-kit (versions wry already uses).
- Old `browser_eval` (picker) and `browser_screenshot` (`screencapture -R`, picker only) unchanged.

## Evidence (Dev Test.app copy, temp HOME, PID started and stopped by me)
- Control socket: open → snapshot → type + click Send by ref → wait text → click "Worked for" → inspect → screenshot (1032x683) → crop by ref (1032x86) → stale ref error. resize 390x600 (no zoom), 1600x900 (zoom 0.645, page reports `viewport: 1600x900`), reset.
- MCP stdio (`/tmp/ac2/mcpcall.py`): screenshot returns `image/png` block.
- Real Claude chat (Sonnet 5.5) in the test app: ToolSearch → 3 × `aurelia_browser` (snapshot, click ref, screenshot) → described the opened "Worked for" text correctly. Screenshot `.../AureliaCode Dev/snaps/agent-1793795131785.png` (temp HOME).
- Page used: a chat-like page via `aurelia_show_html` (scratchpad `chat-check.html`), NOT `design/preview/?view=chat`, see below.

## Known faults / not done
- **Preview harness can't render inside the in-app browser.** Tauri defines `window.__TAURI_INTERNALS__` non-writable in every child webview (`tauri-2.12.5/src/manager/webview.rs:175`); `mockWindows()` throws "Attempted to assign to readonly property" (`design/preview/mock.ts:426`). Blank page for humans too; pre-existing. Options for Jah on the check-in page.
- Same root: external pages in the browser pane see `__TAURI_INTERNALS__` (IPC still refused by capabilities; `browser_webviews_are_not_in_the_capability_list` test). Not changed.
- Test-only: the chat's `claude` runs with the real HOME, so its MCP would reach Jah's real Dev app socket. Pinned for the test by rewriting the test `hooks/claude-mcp.json` to `env HOME=/tmp/ac2/home …`. No product fix (would be `AURELIA_CONTROL_SOCK`).
- Each `aurelia_browser` call asked for approval in the chat ("Always" didn't cover different inputs). Auto mode blocked me from auto-clicking Allow in a loop.
- Not tested: iframes (not descended), `select`, `press`, `hover`, contenteditable typing, pages that navigate on click, multiple browser panes, non-Retina display.

## Queued (Jah, 2026-11-04, not started)
Testing/eval brief (suite audit, MCP/agent eval suite, model comparison, context optimisation, replay). No Codex. Needs a cost estimate and a yes first; fresh session.

## Verification (final code)
tsc: no output · npm test: 220 pass, 0 fail · cargo test: 134 passed, 0 failed, 4 ignored · npm run build: built in 228ms · app:build:dev: Finished 1 bundle

## Resume
Phase 2 per PLAN-AGENT-IDE.md §2 (Sonnet 5.5 medium), or the queued testing brief after its estimate.
