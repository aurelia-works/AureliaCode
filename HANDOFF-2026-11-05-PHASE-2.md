# Handoff: UI pass, Phase 2 of 6, Grid squeeze and toast overlap (2026-11-05)

Plan: `PLAN.md` in the main checkout (uncommitted there). Branch `fix/grid-squeeze`, worktree `../AureliaCode-grid`, from origin/main 69cb549.

## Done
- A tab's grid folds to its focused pane when any pane would get less than 260 px (`src/lib/gridFit.ts`, + test). The need follows the split ratios, so a 25/75 split needs 1040 px.
  - App measures the stage with one ResizeObserver (no polling). Only the active tab folds; the other panes stay mounted.
  - The header says "All threads · 1 of 6 shown"; its tooltip says why and how to get the grid back (close the side panel or widen the window).
  - "All threads" no longer cuts to "A.."; the count gives way first.
- The tripwire card wraps "Keep going" under its text when narrow (`panes.css`).
- The toast sits under the thread header (`--thread-head-h`, tokens.css), so it no longer covers the PR chip.

## Evidence
- Before: 6 panes at 162-163 px with the Changes rail open. After: 1 pane at 490 px; rail closed: 6 panes at 383-384 px (unchanged).
- Toast top 104 px, thread header bottom 94 px (before: toast top 54 px, on the header).
- Tripwire at 200 px and 330 px: text and button don't overlap (measured boxes).

## Not tested
- The real app (only the preview harness and tests).
- Dragging a divider to a squeezing ratio by hand (the logic is tested; the drag wasn't tried).
- No dev-panel slider for the 260 px minimum (Jah's decision 1: no switches for fixes that are on).

## Next
- PR waiting on Jah. Then Phase 3, Settings: remove switches and duplicates.
