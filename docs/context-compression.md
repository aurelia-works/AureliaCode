# Long-session compression

Optional. Off until you install it and turn it on for a Claude account.

AureliaCode can start a **new** Claude Code thread through [billion-context](https://github.com/ranxianglei/billion-context). That program runs a proxy on `127.0.0.1` and launches Claude with `bili --host 127.0.0.1 --no-auto-update --bin <the Claude executable this app already found> claude`. The `--bin` flag has to come before `claude`. Putting it after the name does not select that executable: the installed command passes those words to whatever `claude` is on `PATH`. The proxy forwards the thread to the same Claude provider that account already uses, and it stores compressed summaries on this Mac. The model is still Claude. This is not a local model, not an infinite token window, and not exact recall of older turns: those turns are summaries. Figures published by billion-context (cache hit rate, session length) were not measured here.

## What you turn on

Settings → Accounts → Long-session compression.

- **Install billion-context** resolves the current release when you click, then installs that exact version with `corepack pnpm` into the app's support folder. Nothing is installed until you click. The app does not use sudo or a global npm prefix.
- Each account has **New threads for &lt;name&gt;**. Only a thread created while that switch is on is stamped. Threads already open, and threads created while the switch was off, stay on plain Claude Code.
- Choosing an account on the start screen is the launch. That choice takes the switch as it is then. A thread that has already run keeps the stamp it started with.
- Status in that section is one of: not installed; installed but unavailable; on, with no proxy yet; compressing; or the last compressed thread stopped. A stopped thread is not left running as plain Claude.

## What the launch does

For a stamped thread the app sets a private config and sessions directory for that account, turns billion-context's auto-update, advisory force-install, and release-notes poll off, and does not install billion-context's native Claude plugin (that plugin writes shared Claude settings). The installed Claude lane rewrites `ANTHROPIC_BASE_URL` to `http://127.0.0.1:<port>/bili/https://api.anthropic.com` and does not put `HTTPS_PROXY` or a CA into Claude's environment. The proxy's own default still starts a certificate listener unless MITM is turned off, so the app sets `BILI_MITM=0` and `mitm.enabled: false`. It does not set `HTTPS_PROXY` or hand Claude a CA.

`CLAUDE_CONFIG_DIR` is unchanged: each account still uses its own Claude config directory, and the default `~/.claude` account still leaves that variable unset.

The proxy listens on `127.0.0.1` only. One proxy is **not** shared across threads or accounts. On the installed release, a request carrying `x-claude-code-session-id` is stored under that value verbatim, and a different value is a different key. An `x-claude-code-agent-id` header adds `|sub:<agent>` only when the system prompt is not the main Claude Code prompt; the same header on a main prompt stays on the parent id. Requests with neither header are not given an id by this app. The key has no account dimension, so a shared proxy would mix histories. Each stamped launch starts its own proxy and stops it when Claude exits. Summaries for one account stay in that account's directory.

## When it refuses

A stamped thread does not silently fall back to uncompressed Claude.

- Chat mode reports the reason and does not start the process.
- A terminal pane's `claude` command prints the reason and returns without starting Claude. The shell itself stays up.

It refuses when billion-context or Claude Code is missing, when CLIProxyAPI is also on (both replace the API address), or when the launch already sets `ANTHROPIC_BASE_URL` or `ANTHROPIC_VERTEX_BASE_URL` (the launcher would overwrite it).

Closing the thread signals the wrapper. The wrapper also stops billion-context's proxy. That proxy is started in its own process group, and the launcher only stops it when Claude exits normally, so a closed thread would otherwise leave it running. Closing a thread is not shown as a failure.

If the proxy dies while Claude is still running, requests to the loopback address fail. This app does not start a second proxy under that process: the launcher is the one Claude is talking to, and a replacement would not be that address. Start a new thread. A non-zero exit stays until you clear it or a later compressed launch of that thread exits cleanly. Checking status does not start anything.

## Attribution

billion-context is a separate project. Its license asks products that expose it to link the repository. The link is in Settings → About and in this document.
