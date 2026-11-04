# AureliaCode: handoff (2026-11-04)

Agent-IDE plan: `PLAN-AGENT-IDE.md`. Per-phase notes: `HANDOFF-2026-11-04-PHASE-*.md`.

## Done (on main)
- e21948d #13 Phase 10 redesign: "Needs you" wording, the board's Needs-you lane above Signals, labelled meters, no frozen toast in preview shots. ui-score 5.6 → 6 → 6.3 after the 3 allowed attempts, so the target of 8 wasn't met.
- 32d06ff #12 AureliaBot: from the phone, chat with, approve, start and watch the Mac's agents (Tailscale Serve only; `tailscale.rs` refuses Funnel).
- a6ed031 #11 Phase 7 design council: contrast meets AA in both themes (`npm run contrast`), one primary button, brand-colour switch.
- 7dce522 #10 OpenCode runs as a chat. be203f1 #7 delegation to OpenCode, Claude or Grok.
- Phase 1 browser loop (`aurelia_browser`), see HANDOFF-2026-11-04-PHASE-1.md.

## Waiting on Jah
- **Next design step** (ui-score reviewer's asks, each needing your call): a one-line status instead of the empty state in grid panes, one pane-header pattern across Threads and chat, visible labels on icon-only header controls. PLAN section 10.
- Toast placement (keep / top-right / bottom): card on the check-in page.

## Known faults
- The preview harness can't render inside the in-app browser pane (`__TAURI_INTERNALS__` is read-only in child webviews). It works in a normal browser or with Playwright.
- The Haiku ui-score reviewer reports placeholder text under 4.5:1; `npm run contrast` measures it as passing.
- PLAN table rows 2-6 and 8 still say "todo" though #7/#10 shipped parts of 4-6. Not re-audited.

## Next
- AureliaBot later slices: delegation across agents from the phone, team runs, push notifications, attachments (PLAN section 9). Not scheduled.
- Queued testing/eval brief (suite audit, MCP/agent eval, model comparison). Needs a cost estimate and a yes first; fresh session.

## Worktrees
`AureliaCode-redesign`, `-p9`, `-p7`, `-p4`: their PRs are merged, so they can be removed. `-p10` (feat/video-ui) isn't mine; left alone.

## Resume
`cd AureliaCode && git pull && npm test && npx tsc --noEmit -p .`
