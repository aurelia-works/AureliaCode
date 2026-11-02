# Handoff: 2026-11-01

Branch `feat/agent-harness`, HEAD f4d6a51. All work below is UNCOMMITTED (T3-quiet shell by DeepSeek plus the repair pass).

## Done
- Repair pass over DeepSeek's T3-quiet shell. Gates green: tsc clean, npm test 194, cargo 95, vite build, app:build:dev.
- Logic: `composerEnter` (⌘Enter send mode), `startWorktree` (default survives restart; Settings save no longer resets the switch). Tests in src/lib/threadTools.test.ts.
- Restored: thread header controls for bare chats (account switch, usage, mic, split, close), sidebar account names, usage names and bars, text mode switch, Reload from disk (now in Diagnostics), jellyfish behind Threads & keys (off).
- Light theme and palettes: stale hard-coded colours replaced with tokens in deep.css and panes.css.
- Narrow windows: rail floats with its own close button; opening one side no longer folds the other.
- T3 scout: design/T3-SCOUT.md.

## Not tested
- Anything in the real Tauri app (Dev build made, not launched); the preview mock only.
- A chat with real messages (mock chat is empty): timestamps, chat bubble, tool rows, approval card, narrow chat padding.
- Dictation, account switch menu from the thread header, Reload from disk, every non-default palette.

## Next
- Jah checks the Dev app, then says commit. Pick items from design/T3-SCOUT.md.

## Known failures
None in the gates. Two old main-thread SIGABRT crashes (Oct 24 build) are still undiagnosed.

## Resume
`cd ~/Downloads/AureliaSpace && npx vite --port 1437 --strictPort` → http://localhost:1437/design/preview/?view=chat
