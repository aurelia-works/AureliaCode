# Handoff: UI pass, Phase 4 of 6, Settings: 10 sections, one save model (2026-11-05)

Plan: `PLAN.md` in the main checkout. Branch `refactor/settings-ten`, worktree `../AureliaCode-settings10`, **stacked on `refactor/settings-slim` (PR #31)**: merge #31 first, then retarget this PR to main.

## Done
- 27 pages → 10 sections (`src/lib/settingsIndex.ts`): General, Appearance, New threads, Chat & alerts, Accounts & providers, Agents, Background, Connections, Advanced & Labs, About. Each section stacks the old pages' components as parts (`registry.ts` `PART_COMPONENTS`).
- Threads & keys split three ways: view switches → Appearance, review/nightly/merge queue → Background, undo window → Advanced (folded).
- Advanced & Labs: Labs open, then a folded "Advanced" block (Undo, Suggestions, Planner). A search that hits a folded part opens the fold.
- One save model: every row applies at once. Config is written 500 ms after the last edit, and only the changed fields go on top of what is on disk, so rows that save on their own (accounts, proxy hub, palette) are never overwritten. The Save/Discard bar is gone; the header shows "Saved · ⌘Z undoes".
- ⌘Z in Settings undoes config and prefs changes, newest first. Typing in one field counts as one step (merged within 1 s). Inside a text box ⌘Z stays the box's own undo. The global ⌘Z (thread close/settle undo) stands aside while Settings is open.
- B layout CSS: a card per group, a row per setting with the control on the right, switches instead of tick boxes.
- Old ids still work: `settingsSection: "remote"` → Connections, `"my-agents"` → Agents, `?section=providers` → Accounts & providers. Visible "Settings → My agents / Remote / Diagnostics / Agent keys" strings now name the new sections.
- Tests (`settingsIndex.test.ts`, 7): 10 sections hold every part once; every old page's label and every keyword still finds its section; old ids resolve; undo order, merging, no-op skip, 50-step cap.

## Diff size (flag for Jah)
- 829 changed lines with tests (752 without), against a tripwire of about 800 (twice my 400 estimate). The extra is the B-layout CSS and the index data, not patches. Flagged on the PR and the check-in card.

## Not tested
- The real app: only the preview harness (mocked IPC), unit tests and the build. Real config writes, `remoteApply` after a port edit, and the accounts/proxy rows saving alongside a pending write.
- ⌘Z with the native Edit menu's Undo item in the real WKWebView (the preview is Chromium).

## Next
- PR waiting on Jah. Phase 5 (greeting wordmark) and Phase 6 (Background inbox) are on their own branches from main.
