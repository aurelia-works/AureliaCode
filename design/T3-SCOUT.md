# T3 Code scout (2026-11-01)

Source: `/Applications/T3 Code (Beta).app` 0.1.6, read statically with leanrea. Electron app with a local
Node server and a React client. `package.json` says MIT. Strings and chunk names were seen; nothing was run,
so behaviour below is inferred from them. Take ideas, not bundled code.

## Already here
Queue/steer, stash, snooze, settle, background send, pin, chat width, contrast, panel animations, usage page,
diagnostics, searchable settings, scheduled tasks (Routines), element pick in the browser.

## Worth taking, best first
| Idea | Seen as | Why here | Size |
| --- | --- | --- | --- |
| Auto-settle threads | "Auto-settle merged threads", "Auto-settle inactive threads", "Days of inactivity before auto-settle", "Keep threads with a PR" | The sidebar fills up; merged PRs already settle by hand or by event | S |
| Worktree branch naming | "Branch prefix", "Static prefix", "Semantic prefix", "Choose how new worktree branches are named from your first message" | Real behaviour for the thin Worktrees page | S |
| Worktree safety | "Start new worktrees from remote by default", "Keep worktrees with local changes" | Same page; second is partly true already | S |
| Diff settings | "Diff layout", "Hide whitespace changes", "Default diff file state" | Changes rail has none of these | S |
| Compact before send | "Compact and send", "Skip compaction and send this message", "Compact idle threads" | Cheaper long threads; Jah is watching usage | M |
| Context in the composer | `terminalContexts`, `reviewComments`, `previewAnnot` sent with a message; `DiffCommentAnnotation` chunk | Comment on a diff line or pick terminal output and hand it to Claude | M |
| Multi-project PR page | `_chat.pull-requests` route: filter by state, involvement, drafts, labels | One place for every open PR across threads | M |
| Fork a response | "Failed to fork this response", "Complete a run in this fork before merging it back" | Branch a thread, try something, fold it back | L |
| Same task, several models | "Each model starts in its own worktree" | Compare runs side by side | L |
| Cost breakdown | `_chat.usage`: "Cost by type", "Cost by speed", "Cache savings" | Fuller Usage page | M |

## Skip
SSH and linked environments, guest links, mobile app, device leasing, secrets providers, OpenTelemetry export,
Snap Shot capture: large surface, not part of a solo Mac workflow. Also the "Boring sidebar (group by project)"
lab: the status groups are the point of this sidebar.
