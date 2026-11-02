# Direction: T3-quiet

- **Purpose:** a working surface for many agent threads; the first action is to start one or re-enter one.
- **Audience:** a solo builder running several coding agents all day, reading the screen at a glance.
- **Tone:** calm, neutral, utilitarian. No decoration that does not carry state.
- **Memorable thing:** the project name lives inside the question, so the composer is already scoped.
- **Mode:** operate. Compact density, 4px base, black canvas, zinc hairlines, one indigo action, amber only when a person is needed.

Tokens live in `src/styles/tokens.css` (`--bg`, `--surface`, `--border`, `--text`, `--accent`, `--attn`).
The shell is deliberately T3-like: sidebar first, a single breadcrumb, one centered column, and secondary tools folded behind one row.

Settings follow T3's shape too: a searchable, grouped nav; a breadcrumb header; and sections for Chat, Browser, Worktrees, Usage, Diagnostics and About alongside the existing app sections.
