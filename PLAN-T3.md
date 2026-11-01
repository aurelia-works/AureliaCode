# Ideas from T3 Code: phase plan

Source: teardown of github.com/pingdotgg/t3code (MIT, cloned to a scratch folder, `leanrea` method: inventory, then slices). Read: README, `docs/user/*`, default keybindings (`packages/shared/src/keybindings.ts`), the sidebar undo code (`apps/web/src/hooks/showThreadUndoNotice.ts`). Ideas only, no code copied. Jah's call 2026-10-28: do all of it, run all phases in one go, commit first (planner work is `998d654`).

Rules for every phase: each visible feature gets a switch in Settings → Sidebar & keys (on/off, plus sliders where it has a size); a failing test first for logic; tsc, `npm test`, `cargo test` if Rust, `npm run build`, and a preview screenshot for UI; no commit until Jah says.

## Phases
Agent-time estimates, Sonnet 5.5 medium for all (plain UI and store logic, no hard design).

| # | Phase | Estimate (agent time) | Actual | Status |
| --- | --- | --- | --- | --- |
| 1 | Undo for close, settle, snooze (toast + ⌘Z) and reopen closed thread (⌘⇧T) | about 60 min | not measured | built, 2 review rounds |
| 2 | Pinned threads, sidebar keyboard (↑↓ Enter, F2 rename, ⇧F10 menu). ⌘1–⌘9 dropped: it already switches tabs | about 75 min | not measured | built |
| 3 | Drag threads between sections (pin, settle, wake) with the drop label | about 60 min | not measured | built |
| 4 | Start in background (send and open a fresh composer), stash a composer draft, thread without a project | about 75 min | not measured | built |
| 5 | Queue or Steer toggle with an opposite-action key, palette `>` actions filter, copy PR link and number, retitle (local, no model call) | about 60 min | not measured | built |
| 6 | Copy prompt link (the `aureliaspace://` handler already existed), drop files onto a thread row, back and forward between threads | about 60 min | not measured | built |

Total about 6.5 hours of agent time.

## What each ships (T3 behaviour we borrow)
1. A 5-second toast "Settled 1 thread · Undo"; ⌘Z undoes the latest while the toast is up. Middle-click and the Close button go through it. A closed thread's saved conversation reopens with ⌘⇧T.
2. Pin keeps a thread above active work; settling removes the pin. ⌘1–⌘9 follow the visible order. F2 renames the focused thread.
3. Drag up into the pinned strip pins, onto Settled settles, out of Settled wakes; the dragged row shows the action it will do.
4. ⌘⌥Enter sends and opens a new draft. ⌘S stashes the composer text and brings it back. "No project" starts in its own scratch folder.
5. Follow-up behaviour while the agent runs: Queue or Steer, with a key for the opposite for one message. `>` in the palette lists only actions. Copy PR link or number. Regenerate a thread's title.
6. A link opens a draft with the prompt filled and never sends it. Files dropped on a thread row attach to its composer. ⌘[ and ⌘] go back and forward.

## Not in scope
Mobile apps, remote access, MCP server, SnapShots, themes gallery, usage page (we already have a usage strip), T3's server or provider layer.

## Notes
- Phase 1 comes first because middle-click close has no undo today.
- A phase that grows past its estimate is split; the plan is updated, not the scope.
