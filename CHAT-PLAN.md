# Chat panes: plan (hybrid redesign)

Decided by Jah, 2026-10-23:
- Hybrid. Chat is the default way to work with Claude Code and Codex. The terminal stays for the rare times you need a shell.
- Keep the name AureliaSpace and the bundle id `space.aurelia.terminal`, so macOS permission and Keychain grants survive.
- Clean-room: take ideas from PandaCode, never its code. Copying code would force a "fork of PandaCode" notice.

Agent time: phases 1–3 took about a session each; phases 4–5 are about 30–60 minutes each.

## How chat works
No terminal UI is drawn. Each chat pane runs the CLI in its headless protocol mode and draws the conversation itself:
- **Claude Code** (2.1.309): `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --verbose --permission-prompt-tool stdio`
  - one `CLAUDE_CONFIG_DIR` per account, so it uses the same logins as today
  - continue a chat with `--resume <session id>`
  - stop a turn with the control request `interrupt`
- **Codex** (0.159.2): `codex app-server` (JSON-RPC)
  - start with `thread/start` and continue with `thread/resume`
  - each message is `turn/start`, and `turn/interrupt` stops it
  - `CODEX_HOME` per account
- Check every flag and event against the installed CLIs (`--help`, and the app-server schemas), not against PandaCode's docs.
- Grok, DeepSeek, OpenCode and Gemini stay terminal panes for now.

## Status (2026-10-23)
Phases 1–3 committed. Phases 4–5 written (see HANDOFF.md), untested in the app.
Added: "Continue this conversation as a chat" (terminal → chat, `openInChat` in lib/fork.ts).
Shift+Tab verified; stress test passed (see HANDOFF.md). Open: dispatch review, dictation, HUD.

## Phases
1. **Backend: `src-tauri/src/chat.rs`.**
   - Spawn, write JSON lines to stdin, parse stdout, and forward typed events over a Tauri channel (same pattern as `pty.rs`).
   - Handle approval requests: hold the request, ask the UI, answer it.
   - Store the session id in the pane meta, so a chat survives an app restart.
2. **Frontend: `ChatPane.tsx`.**
   - Message list with streaming Markdown.
   - Tool calls folded into one line each, click to open.
   - Approval bar above the composer (reuse `Composer.tsx`).
   - A "changed files" row after each turn that opens `DiffReview`.
   - New `PaneMeta.mode: "chat" | "terminal"`.
3. **Wire existing features to chat events instead of terminal output:**
   - agent status, notifications, HUD and ⌘J (finished and waiting come straight from the events)
   - ⌥⌘V dictation types into the chat composer
   - `aurelia_read_pane` returns the transcript, and `aurelia_send_to_pane` sends a message
   - account handoff resumes the session id on the other account (test whether resuming across config dirs works)
   - cache badge, queue rail
4. **Start screen.**
   - Picking a Claude account or Codex opens a chat by default. "Terminal" stays as one quiet option.
   - Settings get a default-mode switch.
   - Any chat can "Open in terminal" (`claude --resume <id>` in a PTY pane) for the rare cases.
5. **Usage, our own version.** AureliaSpace already has the 5h/7d meter per account (`usage.rs`, `UsageMeter.tsx`). Chat adds exact numbers for free:
   - the `result` event gives tokens and cost for each turn, and Codex sends token counts
   - one chip in the chat header: context used (bar), plus this chat's tokens and cost
   - details on hover, nothing more on screen (quiet-UI rule)

## What "mods" means
- **Keep working in chat:** skills, slash commands, hooks, MCP servers, subagents. They run inside the CLI.
- **Stop working in chat:**
  - Claude Code's own on-screen add-ons: the status line (yours is `~/.claude/statusline-command.sh`), side panels, bands, toasts
  - they're drawn by the terminal UI, which chat doesn't show
- **The fix:** AureliaSpace shows those facts natively (usage chip, cache badge, HUD).
- **Later:** an add-on slot for chat panes, if more are wanted.

## Answered (2026-10-23)
- Go-ahead given. Build all phases on `feat/chat-panes`.
- New chats only. Old terminal sessions don't appear in the chat list.

- Slash-command menu v1: Claude Code only.
- Codex chat removed (Jah has no Codex or ChatGPT subscription). Chat is Claude Code only; Codex stays a terminal pane.
