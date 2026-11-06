# Hill-climb iteration 1

Evaluator: one reviewer (Grok 4.7). `npm run ui-score` needs the `claude` CLI, which is not installed here, so this is not an independent model and not a council. The same person scored the baseline and the after shots, against the same notes.

Rubric, fixed for this climb. Each category is 1–10. 10 means nothing left to fix on that screen. The overall is the mean, to one decimal. Text contrast was also measured with `npm run contrast` (every token pair ≥ 4.5:1 in dark and light).

- **Typography.** A clear type scale, readable line length, tabular numbers where numbers change, and no truncation that hides what something is.
- **Hierarchy.** The thread you need is the focus. The one next action stands out, and secondary controls recede.
- **Contrast.** Text meets WCAG AA. Colour means state. Edges that separate regions are visible.
- **Spacing.** One spacing scale, aligned edges, related things grouped, no cramped or floating elements.
- **Consistency.** The same thread, button, and state look the same across the screen.
- **Accessibility / clarity.** A new person can tell what each control does and what state the thread is in. Empty states say what to do, and they don't describe a control that isn't there.

## What was scored

The core workflow is the threads grid: start or re-enter several agent threads and see what each one needs. Chat and the new-thread screen were scored as context and checked again for regressions. They were not the change.

Shots are the real UI (`design/preview/`, mocked Tauri IPC) at 1440×900, dark, reduced motion, device scale 2. Same mock state before and after.

| View | Baseline | After |
| --- | --- | --- |
| `threads` | `.shots/baseline/threads-after.png` | `.shots/after/threads-after.png` |
| `threads&single=1` | `.shots/baseline/threads-single-1-after.png` | `.shots/after/threads-single-1-after.png` |
| `chat` | `.shots/baseline/chat-after.png` | `.shots/after/chat-after.png` |
| `start` | `.shots/baseline/start-after.png` | `.shots/after/start-after.png` |

Chat, start, and the single-thread view are pixel-identical after the change (SSIM 1). Only the grid moved.

## Baseline — threads grid — 5.3

| Category | Score | Why |
| --- | --- | --- |
| Typography | 5 | Pane headers cut the thread name mid-word (`Backfill org_id for existing us…`, `Add idempotency keys to refu…`, `Rewrite the quickstart for the new…`). The sidebar does the same (`Keyboard-accessible se…`) and cuts the branch (`aure…`). The parent link stops at `from Keyboard-accessible s…`. The screen also uses five sizes (label, meta, body, title, and the page wordmark). |
| Hierarchy | 5 | Needs-you has a gold edge and an Answer button, but the card is a short island. Most of the cell is empty black, so the thread that needs you does not own its cell. Working, finished, and idle cards are the same kind of island. |
| Contrast | 7 | `npm run contrast`: every token pair meets 4.5:1 (dark `--text` on `--bg` 18.90:1, `--text-dim` on `--surface` 9.29:1, `--text-faint` on `--bg` 7.53:1, `--attn` on `--bg` 11.38:1). Idle and working card edges are a 7% white hairline, so the card boundary disappears into the black cell. |
| Spacing | 4 | Inside a card the gaps follow the 4px scale. The dominant fact is the empty black under every short card (measured: a needs-you card sat in the top of a ~400px cell). Footers did not align across the row. |
| Consistency | 6 | Status words match on the cards. Answer is the solid primary; the other actions are the same outline button. The same thread's name is truncated differently in the sidebar and the pane header. |
| Accessibility / clarity | 5 | Grid, Changes, and More are labelled. The idle card said "Type below to start it" while the composer is hidden on an unfocused cell, so the sentence described a control that was not there. Truncation hid which thread a cell was. |

Context, not changed: chat 7.2 (the approval, with Allow, is the next action). Start 6.5 (the question is clear, and the composer sits under a large empty field).

## After — threads grid — 6.3

| Category | Score | Why |
| --- | --- | --- |
| Typography | 6 | Narrow columns now show the whole name, up to two lines, at the body size: `Backfill org_id for existing users`, `Rewrite the quickstart for the new CLI flags`, `Add idempotency keys to refunds`. The parent link reads `from Keyboard-accessible settings nav`. Headers in a row are 43–44px and share a top edge. Still deducted: the sidebar still cuts those same names and the branch `aure…`, and the screen still uses five sizes. |
| Hierarchy | 7 | An unfocused cell is one status surface. Needs-you is a full gold-bordered cell; Answer stays with the question; folder, branch, and diff sit on the bottom edge. The focused cell keeps its composer. Still deducted: the lower half of a short cell is empty surface, and the sidebar still marks "needs you" with an icon and no word. |
| Contrast | 7 | Same measured pairs. The needs-you outline now wraps the whole cell, which makes that state easier to see. Idle and working edges are still the same hairline, so the category does not move. |
| Spacing | 6 | Unfocused cards fill the cell to a 12px inset (`--sp-3`). Meta sits on the bottom edge and is not clipped (measured card bottom vs pane bottom). Related things stay grouped: the ask with its button, the place and the diff as the footer. Still deducted: the open middle of a short cell is a lot of unused surface. |
| Consistency | 6 | Grid headers now agree with each other on the full name. The sidebar still truncates the same thread, so the screen does not yet show one name one way. |
| Accessibility / clarity | 6 | Idle copy is now "Not started in api-server." The button still says "Start this thread." Full grid titles tell you which thread the cell is. Still deducted: sidebar truncation, icon-only sidebar state, and the unexplained `4.4×` badge. |

Overall 5.3 → 6.3. Not a 9, and not the project's ship bar of 8.

## Remaining gaps

1. Sidebar rows still hide the thread and the branch (`Keyboard-accessible se…`, `aure…`). That is the next typography and clarity cut, on the same screen.
2. Short cells are one surface now, and the middle is still empty. A later pass can use that space for the permission or the last step, without adding a second card.
3. The single-thread view still names one thread twice: the thread header says "New thread" and the pane header says "Keyboard-accessible settings nav".
4. Sidebar state is still a glyph without the word, and idle/working cell edges are still hairlines.
