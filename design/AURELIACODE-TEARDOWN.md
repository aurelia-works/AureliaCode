# AureliaCode Phase 0 teardown: PandaCode, Grok Bot, T3 Code, CLIProxyAPI

2026-11-02. Haiku scout, `leanrea` method, static reading of copies (no app launched).
Evidence: **seen** = string/file found, **inferred**, **unknown**. Other people's apps: ideas only, no code or assets copied.
Earlier notes: `design/T3-SCOUT.md`, `PLAN-HARNESS.md` (PandaCode row).

## PandaCode 0.3.90 (`ai.pandacode.desktop`, Tauri 2 + Rust + SQLite, same stack as ours)
- **Tray (seen):** Tauri `TrayIcon` + popover window (`index.html?view=tray`). Commands `tray_refresh_usage`, `tray_snapshot`, `tray_open_session`, `tray_show_app`, `tray_resize`, `tray_quit`; event `tray-changed`. Popover likely lists tasks/sessions + plan usage (inferred).
- **Plan usage (seen):** reads keychain `Claude Code-credentials-…` (`claudeAiOauth.accessToken`), calls `GET api.anthropic.com/api/oauth/usage` (`anthropic-beta: oauth-2025-04-20`). Fields: `five_hour`, `seven_day`, `seven_day_opus`, `extra_usage`. Our `usage.rs` + `fetch-usage.sh` already do the same thing.
- Codex limits via `codex app-server` JSON-RPC `account/rateLimits/read`, `account/usage/read` (seen). GLM/Kimi have their own quota routes; others report "does not expose usage".
- **Spend (seen):** local ledger over `~/.claude/projects/` with `usage-ledger-cache.json`; prices fetched from OpenRouter `/api/v1/models` + vendor pricing pages; split by `attributedAgent` (claude / codex). No admin/org cost API used. 24h/7d/30d labels not found (unknown).
- Telemetry: no analytics SDK found; has Tauri updater; a "telemetry flush" string of unknown origin.
- Grok-Bot-like features: none. `bots/` = Discord/Slack/Telegram/WhatsApp channel bots.
- Top ideas: per-harness usage meters with honest "not available" states; local spend ledger with price catalogue; tray popover with live sessions; task board; architect + 3 workers; tiered model routing; scheduled tasks; per-connection credentials.

## Grok Bot 0.78.1 (`com.anysphere.sand`, Electron 42, Anysphere/Cursor codebase)
- **Menubar roster (seen, off by default flag `sand_menubar_tray`):** one face per agent (108 `bot-*.png` faces), status as tray title, context menu; reacts to agent activity events.
- **Desktop companion panel (seen):** `desktop-mount-panel` with companions + history; presence "park" states (`awayPark`, `presentPark`, `idle_park`) that hold/wake agents.
- **Avatars (seen):** per-bot colour + shape, generated or uploaded.
- **Realtime voice (seen flags):** voice calls, transcript, voice memos, steer.
- **Computer use (seen):** sidecar helper app, screen preview PiP, VNC.
- Also flagged: "Bonfire" rewards/gamification (meaning unknown), team bots + sharing, Slack/Teams/SMS channels, agent mail, vault/passkeys/1Password, documents/canvas/pages, memory import, automations, MCP marketplace, places map, payments, usage banner, loop detection, audit logs. "Persona": unknown.
- Telemetry (seen): Sentry, OpenTelemetry, Statsig, `@anysphere/analytics-client`.

## T3 Code (Beta) 0.1.6 (`com.t3tools.t3code`, Electron)
- No tray / menubar item (no `Tray(` in asar).
- `user-select: none` only in the element-picker preload, not the chat (seen). Cmd+A behaviour untested.
- Layout per `T3-SCOUT.md`: thread/project sidebar, chat centre, changes rail.

## CLIProxyAPI (Theo's gist, github.com/router-for-me/CLIProxyAPI)
- One always-on home machine signs in to Claude + Codex accounts and exposes one API at `127.0.0.1:8317` (Tailscale serve for other machines). `brew install cliproxyapi`; config `$(brew --prefix)/etc/cliproxyapi.conf`; `-claude-login`, `-codex-login`.
- Clients: Claude Code via `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` in `~/.claude/settings.json`; Codex via `model_provider = "cliproxy"` in `~/.codex/config.toml`.
- Usage: management page `/management.html` with pooled quota; no dollar spend. No telemetry mentioned.
- **Terms risk:** the gist itself warns of "possible account bans and terms-of-service issues". The Register (2026-02-20, theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access) reports Anthropic's terms forbid using Free/Pro/Max OAuth tokens "in any other product, tool, or service" and quotes "Third-party harnesses using Claude subscriptions … are prohibited". Secondary sources only; Anthropic's own legal page not fetched.
- Same question applies to reading `/api/oauth/usage` with the subscription token (PandaCode and our `usage.rs` both do) — inferred, not a legal conclusion.

## Recommended layout
T3-style thread sidebar with status groups + chat centre (DOM text, selectable); PandaCode-style usage meters and board as a secondary tab/rail; Tauri tray popover (PandaCode pattern) showing the squid, account, usage and spend, plus a live agent roster (Grok pattern). Companion/park/avatars as dev-panel toggles in Phase 3.

## Not done
No app launched (no screenshots, selection untested). PandaCode front-end tree and Grok Bot "persona"/"Bonfire" not established. Grok Bot telemetry endpoints not isolated. Scratch copies remain in `$TMPDIR/re/`.
