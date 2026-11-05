# Handoff: UI pass, Phase 3 of 6, Settings: remove switches and duplicates (2026-11-05)

Plan: `PLAN.md` in the main checkout (uncommitted there). Branch `refactor/settings-slim`, worktree `../AureliaCode-settings`, from origin/main 69cb549.

## Done
- 33 switches the review page marks "Remove" are gone, with their prefs keys and every `prefs.X &&` check. The features are always on:
  - review: risk badge, explain, ready group, proof line, diff tripwire, revert, scrap, thread cost, sub-agent prompts, thread family, dev server, share link;
  - interface: undo, reopen, middle-click, pin, list keys, drag sections, background start, stash, no project, palette `>`, PR copy, retitle, prompt links, drop files, back/forward, Queue/Steer key, one header, model+effort picker, composer fold, quiet busy threads, row diff stat.
- An old ui.json with any of them set to false is read without them, so the feature is on (`normalizePrefs` drops unknown keys; new test).
- Old-look code paths removed: the separate effort picker (ChatPane), the pre-"one header" agent branch of the pane header (it now draws only shell panes), the brief's title line.
- Labs section (System group): jellyfish icons, bloom, header chips. Threads & keys keeps 6 view switches, 4 review switches and the numbers.
- Duplicates: General → "Claude panes / Start in" is gone (New threads → Permissions); the Worktrees section is gone (New threads → Workspace); Queue/Steer lives in Chat. Search keywords moved with them.
- `StatusBar.tsx` deleted. Visible "AureliaSpace" strings renamed (6 settings strings, ntfy titles, Discord idle text, terminal notices, prompt-link toast). Discord's own app name can't change from code, so that label now reads "Show that I'm coding on my Discord profile".
- `splashMinMs` kept as a pref (default 0) with no Settings row, so its test stays as it was.

## Test change (flag for Jah)
- `src/lib/prefs.test.ts` "known keys … kept": the example keys were `undo` and `pin`, which no longer exist. Swapped to `navRight` and `council` with the same assertions. Added "an old file's switches … are dropped".

## Not tested
- The real app. Only tsc, unit tests, the build and preview screenshots of settings.
- Each always-on feature by hand (they were already on by default; only the off path is gone).

## Next
- PR waiting on Jah. Then Phase 4, Settings: 10 sections, one save model.
