# AureliaCode: handoff before Phase 2 (2026-11-02)

## State
Branch `feat/agent-harness`, HEAD 5fe635d, about 60 uncommitted files. Repo, app name and bundle id (`space.aurelia.code`) are moved. Gates green at this point: tsc clean, npm 209, cargo 106, web build, Dev app build.
Phase 1's terminal removal was not checked in this session: compare the code with the Phase 1 list in PLAN-AURELIACODE.md and report what is left. Don't start on it without Jah saying so.

## Done this session
- `appkit_guard.rs`: stops Objective-C exceptions in `sendEvent:`; they abort under tao's `extern "C"` otherwise. Name, reason and stack go to `~/Library/Logs/Aurelia/panic.log`. Never met a real crash yet: read that log first if one shows up.
- Stray 0x1C-0x1F in text boxes removed, arrows still move the caret (`lib/controlChars.ts`). Why WebKit inserts them is unknown.
- ⌘A is an app menu item (`select-all`), because the Edit menu takes the key before the page. `selectAll()` in `lib/shortcuts.ts` decides. Empty chat box selects the conversation.
- Skill instructions hidden from chat (unit tested only).

## Real-app testing
Run a separate copy with `HOME=<empty temp dir>` on the Dev binary, so Jah's data and his running app aren't touched. System Events `keystroke` works; `click at` doesn't reach the webview, so post CGEvents from a small Swift helper. `first process whose unix id is N` returns the wrong process when several are named aurelia-space: loop instead. Activate with NSRunningApplication and check the front pid before every key. Save and restore the clipboard.

## Known faults
- Jah may still be chatting in old `/Applications/AureliaSpace.app`, which has none of these fixes. Installing the new build to /Applications has not been done.
- The T3/PandaCode screen list is in the 2026-11-02 chat: picker search, quiet start, permission menu, model picker, team menu, token saver, floating settings. Not started.
