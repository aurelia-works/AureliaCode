# Hill-climb iteration 3

Same rubric as hillclimb-1 and hillclimb-2. One reviewer. `npm run ui-score` needs the `claude` CLI, which is not installed, so the scores below are this reviewer's, against the same notes. Text contrast is `npm run contrast`. Geometry is `npm run layout-contract`.

## How the three pieces are owned

Sidebar rows live in `ProjectsSidebar.tsx` (`PaneRow`). The navigator is `--nav-w: 288px` and does not grow. The list scrolls in `.side-list`. Search, New thread, Snoozed, Settled, and the footer (Settings, Go to, Files, Log) stay outside that scroll. Arrow keys move `.th-row`. Pin, Snooze, and Settle are hover buttons with names. A later rule in `deep.css` had forced `.th-title` back to one line and `.th-m` to nowrap, so a long branch was the only thing that could shrink.

The location title is `ThreadHeader`'s `h1`. On the grid it says "All threads". On one thread it used the first chat message, and otherwise "New thread" whenever `freshChat` was true. That is any pane with no sent chat message. It ignored `pane.title` and the attached task. The pane header uses `pane.title`, then the first message, then the task. A zoomed split still shows the pane header (`PaneView` hides it only when the tab is a single chat), so the two titles can disagree.

Grid cards are `.pane-brief` inside `.chat.brief .chat-log`. Unfocused cards are `flex: 1 0 auto`, so they do not shrink. The log can scroll. A previous try let the step list shrink with no floor, and the steps became a 12px sliver. That stayed reverted.

## Checkpoint 1 — sidebar identity

Hypothesis: a second line for the title, a branch that wraps instead of shrinking, and the existing state word (Needs you, Working, Finished, Idle, Starting) on the meta line, would make the row readable without widening the navigator.

Tried and reverted: the state word on the title line. The title box fell to 106px beside the word and the badges, and both long titles were cut again.

Kept. At 1440×900 the navigator is still 288px. "Add idempotency keys to refunds" and "Keyboard-accessible settings nav" are not cut. `aurelia/refund-idempotency` is 192px and not cut (it was 35px). Every stateful row has its word. ArrowDown still moves focus. The composer, Answer, and Start this thread still work. Five rows are fully on screen (was seven). At 1100×700 only two are (was four). The list still scrolls, and the footer stays put.

Threads grid, this reviewer's score: 6.3 → 6.8.

| Category | Before | After | Why |
| --- | --- | --- | --- |
| Typography | 6 | 7 | The two long sidebar titles and the refunds branch are whole. The screen still has the page wordmark as a fifth size. |
| Hierarchy | 7 | 7 | Unchanged in the grid. A short window shows fewer sidebar rows. |
| Contrast | 7 | 7 | State words use the existing tokens. |
| Spacing | 6 | 6 | Card insets are still 12px. Sidebar rows are taller. |
| Consistency | 6 | 7 | The sidebar now shows the same full name as the pane header. |
| Clarity | 6 | 7 | The state is a word. The `4.4×` badge is still unexplained. |

Not a 9. Short panes still clip tall cards.

## Checkpoint 2 — one accurate location title

Hypothesis: the header says New thread because `freshChat` wins before the pane title and the attached task. Use the same order as the pane header (rename, then first message, then task), and in the one-thread view do not repeat that name under it.

Kept. `threads&single=1` h1 is "Keyboard-accessible settings nav", 215px, not cut. The pane header no longer repeats it (it keeps the folder and More). A thread with no name still says New thread. The grid headers are unchanged. Composer, Answer, and Start this thread still work.

Tried nothing else. Hiding the header without a real title would have left the thread unnamed.
