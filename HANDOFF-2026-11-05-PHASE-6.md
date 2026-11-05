# Handoff: UI pass, Phase 6 of 6, Background inbox (2026-11-05)

Plan: `PLAN.md` in the main checkout. Branch `feat/background-inbox`, worktree `../AureliaCode-inbox`, from origin/main 69cb549.

## Done
- Alerts (title bar) opens on two tabs: **Inbox** and Notifications. Inbox is Grok D's one list of background work, what needs you first, then running, failed, done; newest first in each.
- Sources, all existing state, read only while the popover is open (no new timers or polling):
  - delegations: `aurelia_delegate` / `deepseek_agent` / `aurelia_delegation` tool calls in each chat (`useChat`); a background start and its later check are one row;
  - routines: runs this session (`useRoutineRuns`, set in `runRoutine`) with their pane's status;
  - nightly review: `useNightly` (one row per repo, plus one while it runs);
  - PR babysits: panes with `babysit` / `babysitWakes`, with the PR from `usePrs`;
  - team runs: `useTeamRuns`.
- Click a row to open its thread. Rows whose thread is gone are greyed.
- Dev panel: Threads & keys → "Background inbox in Alerts" (pref `inbox`, on). Off, Alerts is the old notification list.
- `src/lib/inbox.ts` is pure; `inbox.test.ts` (8) covers each source, merging, states and ordering.
- Preview: `?view=threads&inbox=1`.

## Not tested
- The real app: real delegations, a routine firing, a nightly run and a babysat PR. Only the preview with seeded stores, tests and build.
- Routine runs from before a restart: only this session's runs are listed (their panes aren't saved with the run times).

## Next
- PR waiting on Jah. Decision 7 (A/C/D layout) gets its own plan.
