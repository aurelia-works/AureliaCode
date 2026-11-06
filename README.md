# AureliaCode

Personal macOS agent IDE (Tauri 2 + React + xterm.js), formerly AureliaSpace: several Claude
Code accounts and other agent CLIs side by side, as chats or terminals, with a board of what
each one needs. See `PRD.md` for scope and `PLAN-AGENT-IDE.md` for the agent-IDE phases.

## Run

```sh
npm install
npm run app:dev     # dev window with hot reload
npm run app:build   # → src-tauri/target/release/bundle/macos/AureliaCode.app
```

Builds are signed with your "Apple Development" certificate (`bundle.macOS.signingIdentity`;
in dev, `src-tauri/.cargo/config.toml` runs `scripts/dev-sign.sh`) under the fixed id
`space.aurelia.code`. macOS ties folder-access and Keychain grants to that signature, so
they survive rebuilds instead of being asked for again on every launch.

## Shortcuts

| Keys | Action |
| --- | --- |
| ⌘T | New tab (start screen: pick a Claude account, Terminal, Codex or Gemini) |
| ⇧⌘1 / ⇧⌘2 / ⇧⌘3 | Mode: Agents board / Terminals / Review |
| ⌘D / ⇧⌘D | Split right / down |
| ⌘W / ⇧⌘W | Close pane / tab |
| ⌥⌘ arrows | Focus pane in that direction |
| ⌘1…9, ⇧⌘[ ] | Switch tab |
| ⌘E / ⇧⌘E | New Claude pane as an account (split / tab) |
| ⌘G | New grid tab (2, 4, 6, 9, 12 or 16 panes) |
| ⌘J | Jump to the agent waiting on you longest |
| ⇧⌘R | Review uncommitted changes, send line comments to Claude |
| ⇧⌘F | Files sidebar |
| ⌘-click | Open a URL, or a `path:line:col` in output in your editor |
| ⌘I | Command suggestion (inserted at the prompt, never run) |
| ⌘B | Agent panel |
| ⌘\ | Projects sidebar |
| ⇧⌘↑ / ⇧⌘↓ | Jump to previous / next command block |
| ⌘K | Clear |
| ⇧⌘H | Toggle the floating HUD |
| ⌥⌘V | Dictate into the focused pane (needs Aurelia Voice) |
| ⌘+ ⌘- ⌘0 | Font size |
| ⌘, | Settings |

## How it works

- **PTY**: `src-tauri/src/pty.rs`, one `portable-pty` per pane. Output reaches the
  frontend as raw bytes over a Tauri channel, batched in 3 ms windows.
- **Command blocks**: zsh starts with `ZDOTDIR` pointing at a tiny bootstrap that
  restores your own `ZDOTDIR`, sources your `.zshenv`, then loads
  `resources/integration.zsh`. That file emits OSC 133 A/C/D plus `OSC 6973` (command
  text and cwd, base64). `src/lib/blocks.ts` turns these into blocks.
  `BlockOverlay.tsx` draws the gutter, the failed-command tint, and the hover toolbar
  (copy command, copy output, rerun). Alt-screen apps and non-zsh shells get a plain
  terminal. Click a block's gutter to select its text.
- **Accounts**: defined in `~/Library/Application Support/AureliaSpace/config.json`
  (auto-detected from `~/.claude*` on first run). A pane launched as an account gets
  `CLAUDE_CONFIG_DIR` (left unset for `~/.claude`) and runs `claude`. Usage comes from
  running your existing `~/.claude/fetch-usage.sh` and reading its
  `/tmp/.claude_usage_cache_*` file. The app never reads credentials itself.
  Accounts are only ever chosen manually.
- **Long-session compression** (optional, off by default): Settings → Accounts can
  install [billion-context](https://github.com/ranxianglei/billion-context) and enable
  it per Claude account. Only a thread created while that account is enabled launches
  through `bili --host 127.0.0.1 --no-auto-update --bin <claude> claude`. The proxy listens on 127.0.0.1, forwards to the existing
  Claude provider, and stores compressed summaries on this Mac. It is not a local model,
  not an infinite window, and recall of older turns is not exact. See
  [docs/context-compression.md](docs/context-compression.md).
- **Agent panel**: inside panes, `claude` is a shell function that adds
  `--settings …/hooks/claude-settings.json`. Those hooks (SessionStart,
  UserPromptSubmit, Pre/PostToolUse, Notification, Stop, SessionEnd) append one JSON
  line to `run/agent-events.jsonl`, which the app tails. Background panes send a macOS
  notification when Claude finishes or needs input. Tasks are stored per git root in
  `tasks.json`, and the pin button attaches a task to the focused pane.
- **Permission prompts**: `src/lib/permissions.ts` reads the bottom of a pane's xterm
  buffer for Claude Code's numbered Yes / No dialog; Allow / Always / Deny buttons (notice
  card, agents board, agent panel) type the option's number, or Esc to deny. Screen
  scraping, so an unrecognised dialog layout simply shows no buttons.
- **Metrics**: hooks pass `transcript_path`; `transcript.rs` returns usage appended to the
  JSONL since an offset (restricted to `.claude*/projects/`), and `store/metrics.ts` turns it
  into context fill, tokens, estimated API-price cost and burn rate. A hot session raises a
  "Hand off" action that opens a fresh pane seeded with the old transcript's path.
- **Links**: `src/lib/links.ts`. URLs and file references in output are underlined;
  ⌘-click opens them. Candidate paths are checked for existence (`files.rs`) relative
  to the pane's cwd (Claude's own cwd in agent panes). Files open in the `editor`
  config command, else Cursor, else VS Code, else the default app.
- **File drops**: dropping files on a pane types their escaped paths at its prompt
  (`src/lib/filedrop.ts`); Tauri's native drop handler would otherwise swallow them.
- **Git**: `git.rs` reads branch/worktree info straight from `.git` (no process per
  poll), shown in pane headers and agent rows. "Own git worktree" (account picker,
  grid picker) runs `git worktree add -b aurelia/<name>` into
  `<repo>.worktrees/<name>` next to the repo. Worktrees are never removed
  automatically; clean up with `git worktree remove`.
- **Review**: ⇧⌘R shows `git diff HEAD` plus untracked files; comments are pasted into
  the chosen Claude pane as one message and submitted.
- **Tasks**: the ▶ button on a task opens the account picker and starts
  `claude '<task>'` in a new pane, attaching the task and marking it doing.
- **Suggestions**: `src-tauri/src/suggest.rs`. Ollama (default,
  `qwen2.5-coder:1.5b`), Gemini or OpenRouter free tiers; keys live in the Keychain
  (service `AureliaSpace`). Sends cwd, shell, and the last 5 commands. The last
  command's output is sent only when "last output" is ticked.
- **Limit forecast**: `src/lib/forecast.ts`, fed by `src/store/usage.ts`. Each usage
  poll adds a sample; a least-squares fit over the last 45 min (5h window) or 18 h (7d)
  projects when you reach 100%. If that is before the reset, the meter shows
  "out in ~1h 40m" and a "limit" notice fires once per window (when under 1 h / 24 h
  away, or at 90%). History is in memory only.
- **HUD**: `src-tauri/src/hud.rs` creates a frameless, transparent, always-on-top,
  non-focusable window (`hud.html`, `src/hud/`) at the top right. It's shown only while
  enabled in Settings (or ⇧⌘H) and AureliaSpace isn't the focused app. The main window
  (`src/lib/hudBridge.ts`) pushes snapshots over events and handles Open / Allow /
  Always / Deny back.
- **Auto effort**: `src/lib/inlineEffort.ts` mirrors what you type at an idle Claude
  prompt. On Enter it picks a level (`effort.rs`); if that differs, it erases the input,
  switches `/effort` for the session and submits the same text. It only acts when Claude's
  input box on screen shows exactly the mirrored text.
- **Composer (⌘L)**: while Claude works, Enter queues a message for the end of the turn
  (`src/lib/outbox.ts`) and ⌘Enter steers it in now. **Save** keeps it in the rail's
  Prompts (click, or drag onto a pane; `{{fields}}` are asked for). **Snap** attaches a
  screenshot path.
- **Prompt links**: `aureliaspace://new?prompt=…[&cwd=…][&account=…]` drafts the prompt;
  a link naming a folder or account asks before opening a pane (`links.rs`, `store/prompts.ts`).
- **Pane header**: permission mode chip (pick ask, auto-edit, plan, auto, bypass; Shift+Tab
  is pressed for you) and an effort · cost chip whose popover shows the status line's
  numbers, Fork conversation (`--fork-session`) and Checkpoints. Settings → General →
  Claude panes sets the mode new panes start in.
- **Checkpoints**: `checkpoints.rs` snapshots the repo before each prompt under
  `refs/aurelia/checkpoints/<pane>/` (throwaway index; untracked files over 5 MB skipped)
  and restores one, saving the current state first.
- **Dispatch with review**: a task started with "Review when it finishes" gets a second
  Claude, in plan mode, reviewing its changes when it ends its turn (`src/lib/dispatch.ts`).
- **Routines**: Settings → Routines opens a Claude pane with a prompt daily or every N
  minutes while the app runs (`src/lib/routines.ts`).
- **Orchestration**: `aurelia-space mcp` also serves `aurelia_*` tools (list, read and
  message panes, open a Claude pane, show an HTML page), answered by the app over a
  user-only socket (`control.rs`, `src/lib/control.ts`).
- **Browser for agents**: `aurelia_browser` lets a pane's agent open, read (element refs),
  click, type, wait on, inspect and screenshot the browser pane beside it (`browser_agent.rs`).
- **Delegation**: `aurelia_delegate` / `aurelia_delegation` hand a task to OpenCode, `claude -p`
  or Grok and follow it in a card in the chat (`delegate.rs`, `src/lib/delegation.ts`).
- **Other providers as chats**: OpenCode runs as a chat too, picked in the composer.
- **AureliaBot (phone remote)**: from the phone, see every agent's status, last reply, goal and
  approvals; read and answer a chat (send, stop, Allow / Always / Deny); start a new agent with
  a provider, model, folder and task. The Mac checks every action (`src/lib/aureliaBot.ts`).
  Reached on this Mac or over the tailnet with `tailscale serve` only; `tailscale.rs` refuses
  any call that mentions Funnel.
- **State**: `layout.json` (tabs, splits, cwd and account per pane), `tasks.json`,
  `ui.json`, `prompts.json`, `routines.json`, all in the app support dir.

## Design checks

- `npm run shots` takes before (merge base) and after screenshots of the preview views a diff
  touches; `--publish` pushes them for the PR's Screenshots table.
- `npm run ui-score -- <views>` scores those views against `design/review/UI-RUBRIC.md` with
  Haiku and prints `SCORE: n/10`.
- `npm run contrast` checks every text/background token pair in both themes for 4.5:1.

## Setup for suggestions

```sh
brew install ollama && ollama serve &
ollama pull qwen2.5-coder:1.5b
```
