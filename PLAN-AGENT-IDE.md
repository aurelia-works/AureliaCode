# AureliaCode: chat-first agent IDE (phase plan)

Asked by Jah 2026-11-04 (long brief: providers, MCP suite, browser loop, composer, timeline, context, PR, design).
Phase 0 (this file) is audit and plan only. Approved by Jah 2026-11-04 (check-in page): plan and order as written, Codex left out, Phase 2 WIP committed first, bundle id stays.

## Which docs win
- `PLAN-AURELIACODE.md` (2026-11-02) beats `CHAT-PLAN.md` (2026-10-23): terminal UI goes completely; chat-first.
- Bundle id is already `space.aurelia.code` (moved 2026-11-02, Jah's call). The brief says "preserve the bundle id": keep it as it is now, no further migration.
- Codex: no sign-in (Jah 2026-11-04). Out of delegation and chat.
- 44 uncommitted files on `feat/agent-harness` are the finished Phase 2 work (last edit 2026-11-02 12:40, no live owner). Kept untouched.

## Gap analysis (from the code, 2026-11-04)
| Area | State | Evidence |
| --- | --- | --- |
| Claude chat (stream-json, resume, fork, rewind, interrupt, approvals, context usage) | EXISTS | `src-tauri/src/chat.rs:349-382`, `chat_rewind`/`chat_context_usage` `:549-573` |
| Chat for other providers | MISSING | Only Claude runs as chat (`chat.rs` builds `claude` argv only). Gemini, OpenCode, Grok etc. are PTY panes. `lib/agents.ts:70-78` is a launcher list with no capabilities |
| Provider/model discovery, capability flags | MISSING | No per-provider capability report; models are a Claude list + free text |
| Delegation | PARTIAL | `deepseek_agent` (`subagents.rs`) runs `opencode run` and **blocks** until done; one configured model; progress notes only. No status, cancel, wait, or other providers. `aurelia_open_pane` opens Claude panes only |
| MCP suite | PARTIAL | 10 `aurelia_*` tools (`orchestrator.rs:16-150`) + `deepseek_agent`. No browser, no delegation status tools. Git/files tools not needed: agents already have Bash/Read (YAGNI) |
| Browser for agents | PARTIAL | `browser_eval` returns `()`, fire-and-forget (`browser.rs:143`); no DOM result ever reaches an agent. Screenshot is `screencapture -R` of a screen rect (`browser.rs:151`), so anything on top of the pane lands in it. Element pick exists (`lib/browserPick.ts`) |
| Visual output | EXISTS | `aurelia_show_html`, token-guarded loopback server (`control.rs:125-170`). Charts/tables can ride on it; no component framework needed |
| Composer attachments | PARTIAL | Images only (`ChatPane.tsx:1113,1319,1344`), re-encoded to JPEG (`:1493-1502`). No PDF/text/JSON/CSV, no chips with size/retry, no expand view |
| Drafts across conversations | EXISTS (in memory) | `lib/chatComposer.ts:10` Map; lost on app restart |
| Slash menu (commands + skills), @files | EXISTS | `ChatPane.tsx:1595`, `chat_commands` (`chat.rs:573`), `lib/skills.ts` |
| Queue / steer | EXISTS | `ChatPane.tsx:1205-1209, 1390-1398` |
| Activity timeline | EXISTS, IMPROVE | Live label + elapsed (`ChatPane.tsx:466-519`), "Worked for Xm Ys" from real timestamps (`:523`). Expanded state is local `useState` and resets on remount |
| Scroll | PARTIAL | Stick-to-bottom works (`ChatPane.tsx:43-118`). No scroll-to-bottom button, no "still working" hint while scrolled up |
| Context meter | EXISTS, IMPROVE | One number since Phase 2 (`lib/contextFill.ts`). No "measured vs estimated" or "updated Xs ago" label |
| 5h/7d usage | EXISTS, IMPROVE | 15 s tick with a per-account interval, no LLM calls (`store/usage.ts:158-164`). Could refresh on turn end instead of only on the timer |
| PR + review | EXISTS, IMPROVE | `pr.rs`, `review.rs`, `DiffReview.tsx`; template (`.github/pull_request_template.md`) has What and why / Testing / Risk / How to revert. No screenshot step |
| Terminal retirement | PARTIAL | `xterm` still in `package.json` and 10 src files; Start screen still offers "Terminal" (`StartScreen.tsx:143`) |
| Model selector | PARTIAL | Claude model/effort only (`chat_configure`, `chat.rs:514`) |
| Pastel | dev aid only | Not installed. Use from a script for contrast checks, never at runtime |

T3 comparison so far comes from `design/T3-SCOUT.md` (static read of the T3 app bundle) and `design/AURELIACODE-TEARDOWN.md`, not T3 source. Each phase reads the specific T3 source it borrows from (named per phase) before building.

NOT WORTH IT from T3: its Node server and full provider layer, SSH/remote environments, mobile, guest links, OpenTelemetry, a second bundled browser runtime inside the app.

## Phases
Estimates: agent time and rough tokens incl. cache reads, from PLAN-T3 / PLAN-AURELIACODE actuals (60-75 min, 1-2M tokens per UI phase of similar size).

| # | Phase | Estimate | Actual | Model | Status |
| --- | --- | --- | --- | --- | --- |
| 0 | Audit + plan | 30 min | not measured | Opus 5.5 | done, approved 2026-11-04 |
| 1 | Browser loop for agents | 2-2.5 h, 2-3M | not measured | Opus 5.5 medium | done 2026-11-04 (preview harness can't render in-pane, see HANDOFF-2026-11-04-PHASE-1.md) |
| 2 | Timeline, scroll, context/usage freshness | 1-1.5 h, 1-2M | | Sonnet 5.5 medium | todo |
| 3 | Composer: attachments, plus menu, expand view | 1.5-2 h, 2M | | Sonnet 5.5 medium | todo |
| 4 | Providers: discovery, capabilities, model selector | 2-2.5 h, 2-3M | | Opus 5.5 medium | todo |
| 5 | Delegation v2 (any provider, async, cards in chat) | 2.5-3 h, 3M | | Opus 5.5 medium | todo |
| 6 | Non-Claude chat (OpenCode first) + terminal UI out | 3 h, 3-4M (may split) | | Opus 5.5 medium | todo |
| 7 | Design council: baseline, scores, 2 rounds | 1.5-2 h, 2M | not measured | Opus 5.5 | done 2026-11-04 (ui-score 5.5 → 5.6 → 5.6; contrast AA in both themes) |
| 8 | Shorter PR template + screenshot evidence | 45-60 min, 1M | | Sonnet 5.5 medium | todo |

Total about 15-18 h of agent time, 16-22M tokens. Order is by impact and dependency; 1, 2, 3, 8 stand alone.

### 1. Browser loop for agents
Goal: an agent can open the preview, read the DOM, act, wait, resize, inspect layout and screenshot, then repeat.
- `browser_eval` gets a return path (result posted back over the existing control socket with a request id).
- One MCP tool `aurelia_browser` with an `action` field: `open`, `snapshot` (a11y-style tree with refs), `act` (click/type/press by ref or selector), `wait` (selector/text/idle), `resize`, `inspect` (box, computed style, overlap check for a ref), `screenshot` (WKWebView `takeSnapshot`, not a screen rect).
- T3 source to read first: `apps/server/src/mcp/toolkits/preview`.
- Playwright stays for deterministic checks (`design/preview` harness), not inside the app.
Done when: in the Dev app, a Claude chat asked to check `design/preview/?view=chat` snapshots it, clicks an element by ref, and returns a screenshot of the pane alone; cargo tests for the tool schema and result round-trip.

### 2. Timeline, scroll, context/usage freshness
- Scroll-to-bottom icon button when scrolled up, with a subtle "still working" dot.
- Worked-for expanded state kept per segment across remounts.
- Queued and steered bubbles styled differently from sent ones.
- Context meter says "measured" or "estimate" and "updated Xs ago"; usage refreshes once at turn end (deduped with the timer).
- Live labels: small varied set keyed to the actual tool (`lib/toolPhrase.ts`).
Done when: `chat` preview screenshots scrolled up and at bottom; unit tests for the label pick and refresh dedup.

### 3. Composer attachments
- Plus menu: images, PDFs, text/source/MD/JSON/CSV, project file (@). Chips: name, size, preview for images, remove, retry on error. Drag, paste. 32 MB cap.
- Check first what Claude Code's stream-json input accepts (document blocks for PDF?). Anything it doesn't take goes as a path reference, said in the chip. No silent conversion.
- Expand button: focused editor over the chat; text, cursor and attachments kept on return.
- T3 source to read first: `docs/user/composer.md`, its attachment chips.
Done when: screenshot with one chip of each kind; a real PDF reaches Claude in the Dev app; tests for type routing and the size cap.

### 4. Providers and model selector
- Rust: one discovery pass per provider CLI (installed, signed in, subscription vs API key, models, capabilities: chat, resume, interrupt, steer, effort, images, files, MCP). Cached, refreshed on demand. No credentials read beyond the CLI's own status commands.
- Selector: provider → model → effort, unavailable ones shown greyed with the reason; last choice remembered. No silent fallback.
- T3 source to read first: provider adapters and model discovery.
Done when: Settings and composer show the real installed providers on Jah's Mac with correct sign-in state; tests on the discovery parsers.

### 5. Delegation v2
- Generalise `deepseek_agent` into `aurelia_delegate` (provider, model, task, read/work mode, wait or not) and `aurelia_delegation` (status, wait, cancel). Backends from phase 4: `opencode run` (any OpenCode Go model, DeepSeek included), `gemini -p`, `claude -p`. No Codex.
- Delegated runs show as cards in the caller's timeline (model, time, result, files touched).
- Keep `deepseek_agent` working until the new tool is proven.
Done when: Claude in the Dev app delegates to DeepSeek without blocking, checks status, gets the result; a cancel stops the process; tests with a fake CLI (pattern in `subagents.rs:647`).

### 6. Non-Claude chat + terminal UI out
- OpenCode chat pane from its JSON event stream, through the phase-4 adapter shape. Others only if their CLIs expose a structured stream.
- Remove the Start screen "Terminal" choice and xterm views behind a dev toggle; PTY/process code stays for the CLIs that need it. A command's output shows as a card.
Done when: an OpenCode/DeepSeek chat works in the Dev app; no terminal visible by default; screenshots.

### 7. Design council
Baseline screenshots of every preview view, scores (typography, hierarchy, colour/contrast, icons), top fixes, Pastel contrast script over `tokens.css`, two refinement rounds, rescore. Scores below 9 say what's missing.

### 8. PR template
Template to What / Why / Details / Screenshots / Tests / Limits, about half today's length, keeping Risk and Revert as one line each. A script that captures before/after preview screenshots for changed views.

## Answered (Jah 2026-11-04)
Plan and order approved. No Codex. Phase 2 WIP committed before Phase 1. Bundle id stays `space.aurelia.code`.
