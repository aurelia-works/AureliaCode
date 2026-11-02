# Handoff: Fold Linkra, start of Phase 1 (2026-10-28)

Phase 0 (planning) done in the previous thread. Nothing built yet. Read PLAN.md first.

## Decisions (Jah, 2026-10-28)
- Plan and cost approved (8 phases, ~8–10 h agent time).
- Settings → Planner is the dev panel for all planner features (taken as approved with the plan).
- Sunset Linkra; no phone use; habits, focus, calendar come along.

## Where Phase 1 starts
1. `git switch -c feat/linkra-fold` from main (main = 262c28a; untracked CHAT-PLAN.md, HANDOFF.md, PLAN.md, this file stay untracked).
2. Run the gates before editing (CLAUDE.md Verification), record the baseline.
3. Build per PLAN.md phase 1.

## Files to read (only these)
- `src-tauri/src/config.rs:418` `state_path` whitelist: add `"planner"`.
- `src/lib/ipc.ts:381-382` `loadState`/`saveState` name unions: add `"planner"`.
- `src/store/ui.ts:109-147` pattern for load/save of a state file.
- `src/components/settings/registry.ts:19-40` adding a settings section = one entry + component file.
- `design/preview/mock.ts` add `planner` state and a `?view=settings&section=planner` preview.
- Linkra schema (not local): `gh api repos/Jahrix/LinkraHQ/contents/packages/shared/src/schema.ts --jq .content | base64 -d` (439 lines; AppStateSchema at line 404, ExportBundleSchema at 433).
- Sample data: `~/Downloads/linkra-export-1773986109051.json` (schema_version 3, top keys `schema_version, created_at, data`; `data` has userSettings, projects, localRepos, dailyGoalsByDate, roadmapCards, sessionLogs, focusSessions, quickCaptures, journalEntries, insights, weeklyReviews, weeklySnapshots, todayPlanByDate, dailyBriefings, github). Habits are NOT in the export (they were Supabase tables); import what exists.

## Notes
- Tests run with `node --test src/lib/*.test.ts`, so put import/mapping logic in `src/lib/planner*.ts` with a `.test.ts` beside it.
- No zod in AureliaSpace (check package.json before adding anything); write plain TS types and a hand validator.
- Drop on import: userSettings.selectedRepos/github tokens, billing fields.

## Known failures
None known.
