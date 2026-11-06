# Hill-climb iteration 2

Evaluator: one reviewer (Grok 4.7). `npm run ui-score` needs the `claude` CLI, which is not installed here, so this is not an independent model. The same person scored the baseline and the after shots, against the same notes as iteration 1.

Rubric, fixed for this climb. Each category is 1–10. 10 means nothing left to fix on that screen. The overall is the mean, to one decimal. Text contrast was also measured with `npm run contrast` (every token pair ≥ 4.5:1 in dark and light).

- **Typography.** A clear type scale, readable line length, tabular numbers where numbers change, and no truncation that hides what something is.
- **Hierarchy.** The thread you need is the focus. The one next action stands out, and secondary controls recede.
- **Contrast.** Text meets WCAG AA. Colour means state. Edges that separate regions are visible.
- **Spacing.** One spacing scale, aligned edges, related things grouped, no cramped or floating elements.
- **Consistency.** The same thread, button, and state look the same across the screen.
- **Accessibility / clarity.** A new person can tell what each control does and what state the thread is in. Empty states say what to do, and they don't describe a control that isn't there.

## Where the grid gets its size

A threads tab is a split of panes (`src/store/layout.ts`). Each pane is `.pane` (`src/components/PaneView.tsx`): `data-state` comes from the agent session (`needs_input`, `working`, `idle`, or `done` when an idle session still has attention). `focused` is the tab's focused pane.

Chat-first panes (`src/lib/paneKind.ts`) render `ChatPane`. In a grid with an empty transcript, the pane gets `.chat.brief` and `PaneBrief` (`src/components/PaneBrief.tsx`). The card's words come from `useThreadSummary` (`src/components/ThreadCard.tsx`): title, state, detail, folder, branch, diff.

Widths:

- `.chat` sets `--chat-col: 736px`. `.chat-col` is `max-width: var(--chat-col); margin: 0 auto`. That column is for reading a conversation.
- An unfocused brief log is a flex column with `padding: var(--sp-3)` (12px). The card (`.pane-brief`) is `flex: 1 0 auto`, so it grows to the cell and the footer (`.tc-meta`) sits on the bottom edge.
- A flex item with `margin: 0 auto` does not stretch. It sizes to its text. A short card is then narrower than the cell, and the spare width becomes equal side margins.

The sidebar (`ProjectsSidebar.tsx`, `.th-title` in `src/styles/deep.css`) is a separate one-line ellipsis. A later rule overrides an earlier two-line clamp, so long titles and branches are cut. This iteration does not change that.

## Hypothesis

The heaviest defect on the threads grid is that short cards do not share the cell. The idle card and the shorter needs-you card float inside the pane, so a row of states does not share an edge. Stretching `.chat.brief .chat-col` to the log width makes every brief card use the same side inset, without a new component.

Sidebar truncation is still real, and it still costs typography and clarity. It is a smaller area than a card that leaves 81px of black on each side of the cell you scan. One change this iteration: the card width.

## What was scored

The core workflow is the threads grid. Shots are the real UI (`design/preview/`, mocked Tauri IPC) at 1440×900, dark, reduced motion, device scale 2. Same mock state before and after.

Measured on the visible grid (pane border box to `.pane-brief` border box):

| Pane | State | Baseline width / side inset / bottom | After width / side inset / bottom |
| --- | --- | --- | --- |
| p1 | needs you | 327px in a 383.7px pane, 28.3px sides, 12px bottom | 359.7px, 12px sides, 12px bottom |
| p2 | working, focused | 351.2px, 16px sides, composer below | unchanged (351.2px, 16px sides) |
| p3 | finished | 359.2px, 12px, 12px bottom | unchanged |
| p4 | working | 359.7px, 12px, 12px bottom | unchanged, still 12px bottom |
| p5 | needs you | 359.2px, 12px, 12px bottom | unchanged |
| p6 | idle | 221px in a 383.2px pane, 81.1px sides, 12px bottom | 359.2px, 12px sides, 12px bottom |

p6's column margin was `0px 69px` plus the log's 12px padding (81px of black each side). p1's was `0px 16.3px` (28px each side). p4, the tallest unfocused working card, was already 12px above the pane, not 4px. A hit test at the pane's horizontal centre finds 12px of `.chat-log` and then the card. On the top row, the row divider covers the bottom 4px of the pane's border box, so 8px of that 12px padding sits above the divider.

At 1100×900 the grid still shows six panes. Unfocused side insets are 12px and nothing scrolls sideways. p2 and p4 are taller than the cell there (the card border passes the pane by 37px and 29px) because `flex: 1 0 auto` will not shrink. That was already true before this change. Letting the step list shrink kept the footer inside but crushed the steps to a 12px sliver, so that try was reverted.

## Baseline — threads grid — 5.8

Rescored from the live baseline, not from iteration 1's written score. Iteration 1 said every unfocused card used a 12px inset. p1 and p6 did not.

| Category | Score | Why |
| --- | --- | --- |
| Typography | 6 | Grid headers show the whole name, up to two lines. The sidebar still cuts `Add idempotency keys to refunds` (161px of 209) and `Keyboard-accessible settings nav` (163 of 208), and the branch `aurelia/refund-idempotency` to 35px. The screen still uses five sizes. |
| Hierarchy | 6 | p5's needs-you card owns its cell. p1's gold edge is an inset card (28px), and the idle card is a 221px island, so the row does not read as six peers. Answer is still the one solid button. |
| Contrast | 7 | `npm run contrast`: every token pair meets 4.5:1 (dark `--text` on `--bg` 18.90:1, `--text-dim` on `--surface` 9.29:1, `--text-faint` on `--bg` 7.53:1, `--attn` on `--bg` 11.38:1). Idle and working edges are still a 7% white hairline. |
| Spacing | 5 | Inside a card the gaps follow the 4px scale, and the unfocused footer is 12px above the pane. The idle card leaves 81px of black on each side. p1 leaves 28px. Those are floating edges, not the 12px inset. |
| Consistency | 5 | One grid shows the same card at 221px, 327px, and 359px. The two needs-you cards do not share a side edge. The sidebar cuts names the pane header shows in full. |
| Accessibility / clarity | 6 | Idle copy is "Not started in api-server." Answer and "Start this thread" are labelled. Still deducted: sidebar truncation, icon-only sidebar state, and the unexplained `4.4×` badge. |

## After — threads grid — 6.3

| Category | Score | Why |
| --- | --- | --- |
| Typography | 6 | Unchanged. Headers still show the full name. The sidebar still cuts the same two titles and the refunds branch. |
| Hierarchy | 7 | Both needs-you cards are full gold cells, and the idle card is the same width as the finished and working cards. Answer stays with the question. Still deducted: the open middle of a short cell, and the sidebar marks "needs you" with an icon and no word. |
| Contrast | 7 | Same measured pairs. The needs-you outline now wraps both cells. Idle and working edges are still the same hairline. |
| Spacing | 6 | Every unfocused card is 12px from the pane on the left, right, and bottom (measured). The footer stays on the bottom edge. Still deducted: the open middle of a short cell, and the focused card's log padding is 16px rather than 12px, so that one card sits 4px further in. |
| Consistency | 6 | Unfocused cards share one width. The focused card is the composer's column (16px). The sidebar still truncates the same thread the header spells out. |
| Accessibility / clarity | 6 | Unchanged. Full card titles, labelled actions, and the same sidebar gaps. |

Overall 5.8 → 6.3. Not a 9.

Checked by using the screen, not only by reading the CSS: typing in the focused composer, Answer on the permission thread (focus moves, the cursor is in that composer, the card stays the width of the log), and "Start this thread" on the idle pane (same). Chat, start, and the single-thread view are not `.chat.brief`; their reading column stays `max-width: 736px` and `margin: 0 auto`.

## Verdict

Kept. The short cards now share the cell. The step-list shrink was reverted.

## Still open

1. Sidebar rows still hide the thread and the branch.
2. The middle of a short cell is empty.
3. The single-thread view still names one thread twice.
4. Sidebar state is still a glyph without the word, and idle/working edges are still hairlines.
5. At 1100×900 a tall working card still runs past the bottom of its pane. The footer is there if you scroll the log. This iteration did not take that on.
