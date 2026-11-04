# Handoff: 2026-11-02, Phase 2 done (Jah-only items open)

Branch `feat/agent-harness`. WIP committed and pushed as 986d514. Everything since is UNCOMMITTED on top of it; keep it, do not commit or push.

## Phase 2 done and checked in the real Dev app
- **Squid menubar.** Root cause was macOS menu bar auto-hide (`defaults read NSGlobalDomain _HIHideMenuBar` = 1), not the app. The status item exists at `1038,3 / 36x24` and is not pushed off a 1920-wide screen. When the menu bar is shown (pointer to the top edge) the squid is visible and a real left click opens the popover, so `on_tray_icon_event` fires. Launch the bundle with `open`, not the raw binary. AXPress on the status item activates the app/menu instead of the popover; a real click is the supported path. The long-running Dev app (PID 23223, started 10:47) predates the 11:30 tray build and has no status item; a freshly launched bundle does.
- **Popover with real numbers.** Final screenshot: `/tmp/ac2/final-popover.png` (test copy, real accounts/usage). 7d: **$319**, 893.8M tokens; opus-5.5 $272, sonnet-5.5 $42.52, haiku-5.5 $4.48. Accounts row shows 93% 5h / 18% 7d, 0% / 7%, and one account with no usage. Streamer blur checked on the final build: email unreadable at 2 s, readable after 3 s hover (the CSS starts a 1.2 s fade at 3 s), and click keeps it readable. Evidence: `/tmp/ac2/final-blur-2s.png`, `final-blur-3.8s.png`, `final-blur-click.png`.
- **First ledger scan on real logs.** 704 files, **3.7 GB** at scan time (the earlier 2.9 GB figure predates log growth), 42,638 replies, 7.0 MB `ledger.db`. Cold end-to-end from popover click: **16.04 s** (live price fetch 0.62 s, then the scan); warm scan with prices cached: **15.45 s**. Live pricing page parses: 20 models, 3 fast; the app's `prices.json` and api-bill's live prices have **0 rate differences**. 7d total **$319.26** from the ledger vs **$319.27** from summing api-bill over `~/.claude`, `~/.claude-a`, `~/.claude-b` (1 cent, window edge).
- **CLIProxyAPI smoke test (`-local-model`).** Hub on `127.0.0.1:8398`: no key 401, key 200. With `-local-model`: **no** connections to `models.router-for.me` or `raw.githubusercontent.com` catalog sources and **no** catalog-refresh warnings; the log says `Local model mode: using embedded catalogs…`. Without it: 7 catalog connections and 3 × `model catalog refresh failed`. Not signed in, switch left off, no routed turn.

## Earlier Phase 2 work (kept)
- One context number: `lib/contextFill.ts`, `paneContext`/`usePaneContext` in `store/metrics.ts`; ring, rail, bell and HUD agree. Root cause: headless Claude Code never runs the status line, so metrics guessed 200k; the real window is 350k (`modelSettings.autoCompactWindow`).
- One context card per thread, running threads too; clears after compaction; bell empty; ring updates.
- Mid-turn bubble appears at the point Claude received it and survives reopening (`queued_command` attachments in `chat_history`).
- Burning-fast, 5-hour, 7-day and cold-cache cards update/retire; finished card skipped while a message is queued. Settings → Sounds → What alerts you (nothing cut).
- Ledger (`ledger.rs`), real spend (`spend.rs`), tray (`tray.rs`, `src/tray/`, `lib/trayIcon.ts`), Settings → Menu bar, streamer blur.

## Open / not tested
- **Real API spend:** no Admin keys were available. Anthropic and OpenAI both show "Not available". Jah's keys only; do not add them yourself.
- **CLIProxyAPI sign-in and a routed Claude turn:** not tested. Sign-in is Jah's; the switch stays off. Do not sign in or turn it on.
- **Notifications:** no notification was cut. Ask Jah which ones annoy him before changing any.
- **Install:** `/Applications` still has the old app; the new Dev bundle was not installed there.

## Known faults
- The hub still phones out for Antigravity and Grok CLI version checks (Antigravity updater, npm registry); no setting found. `-local-model` stops only the catalog fetch.
- Codex shows "Not available": its session logs have no token counts.
- The context card sits over the composer's ring while open.
- With menu-bar auto-hide on, the squid is hidden until the pointer reaches the top edge; clicking where it would be hits the window below. This is macOS behavior, not an app bug.

## Test setup
- Temp HOME `/tmp/ac2/home`; `.zshenv` sets the real HOME for the CLI only and `CLAUDE_CODE_AUTO_COMPACT_WINDOW=300000` (floor 100000).
- Helpers in `/tmp/ac2`: `ctl.py` (control socket), `w.sh`, `wins`, `clickat`, `moveto`, `winbounds`, `listitems`, `proxylog.py`. Rebuild `moveto`/`winbounds` with `swiftc -O <name>.swift -o <name>` if missing.
- Port 1437 is taken by another node process; vite on 1441.
- Test app copy `/tmp/ac2/AureliaCode Dev Test.app`, launched with:
  `open -n --env HOME=/tmp/ac2/home --env CLAUDE_CODE_AUTO_COMPACT_WINDOW=300000 --stderr /tmp/ac2/app-final.log "AureliaCode Dev Test.app"`
  It was killed after testing; PID was in `/tmp/ac2/final.pid`.
- Real logs: `~/.claude/projects`, `~/.claude-a/projects`, `~/.claude-b/projects` (read-only). Temp ledger DB: `/tmp/ac2/home/Library/Application Support/AureliaCode Dev/ledger.db`.

## Resume
`npx vite --port 1441 --strictPort` → http://localhost:1441/design/preview/?view=tray&streamer=1

To use the real tray: reveal the menu bar (`/tmp/ac2/moveto 960 0`, or move the pointer to the top edge), then click the squid at about `1056,15`.

## Verification (final code)
| Step | Result |
| --- | --- |
| `npx tsc --noEmit -p .` | no output (exit 0) |
| `npm test` | tests 217, pass 217, fail 0, skipped 0 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 128 passed; 0 failed; 4 ignored (lib), 0 passed (main), 0 passed (doc-tests) |
| `npm run build` | `✓ built in 238ms` |
| `npm run app:build:dev` | `Finished dev profile ... in 39.62s`; `Finished 1 bundle at ... (52.57 MiB)` |
