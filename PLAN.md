# Fold Linkra into AureliaSpace: phase plan

Decided by Jah, 2026-10-28 (plan and cost approved):
- Sunset the Linkra web app (github.com/Jahrix/LinkraHQ). Its useful features move into AureliaSpace; the rest is dropped.
- No phone use, so losing the PWA is fine.
- Habits, focus sessions and calendar come along.
- Later: archive the LinkraHQ repo as private (phase 8, Jah's call when).

## What moves, merges or goes
| Moves in | Merges into what AureliaSpace has | Dropped |
| --- | --- | --- |
| Today plan and daily goals (points) | Commits / local git scan → Changes panel, threads, PR flags | Stripe billing, tiers, quota |
| Roadmap lanes per project (now / next / later / shipped) | Linkra Agent chat → real chat threads | Waitlist, public profiles, landing, maintenance switch |
| Habits (streaks) and focus sessions | Build My Plan / Fill My Day → a thread that writes the plan | Supabase auth and sync, Cloudflare worker, API keys |
| Signals (project health) → Board suggestions | Quick capture → command palette | 3D scenes, Remotion video, PWA |
| Daily briefing, weekly review | Session logs → thread history | GitHub OAuth (AureliaSpace uses `gh`) |
| Journal and scratchpad per project | | |
| Calendar (read) | | |

## How it fits
- Data: one local state file `planner` through the existing `load_state`/`save_state` (`src-tauri/src/config.rs:457`). No server, no account.
- Logic: port Linkra's pure TS from `packages/shared/src` (`schema.ts` types, `insightsRules.ts`, `buildPlan.ts`, `weekly.ts`) with their tests, rewritten for `node --test`. Zod dropped unless already a dependency.
- Projects: Linkra projects map to AureliaSpace projects by repo path; unmatched ones stay as "no folder" projects.
- Calendar: read macOS Calendar (EventKit) from Rust instead of Google OAuth. Calendar.app already syncs your Google calendar, so no client ID or login to keep alive.
- Dev panel: every visible piece gets an on/off switch (and sizes/colours where it has them) in a new Settings → Planner section. Approved with the plan (2026-10-28).

## Phases
Token estimates: about 40–60k to read the files named in the handoff, plus about 8–12k per 100 lines written, plus about 30k for gates and screenshots. Agent time is given beside it.

| # | Phase | Estimate | Actual | Model | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Planner store and Linkra import | 150–220k tok, ~1 h | | Sonnet 5.5, medium | not started |
| 2 | Today: plan and goals on the start screen | 200–280k tok, ~1–1.5 h | | Sonnet 5.5, medium | not started |
| 3 | Roadmap per project, with write-back | 220–300k tok, ~1.5 h | | Sonnet 5.5, high | not started |
| 4 | Habits and focus sessions | 150–220k tok, ~1 h | | Sonnet 5.5, medium | not started |
| 5 | Signals on the Board and daily briefing | 180–250k tok, ~1–1.5 h | | Sonnet 5.5, medium | not started |
| 6 | Weekly review, journal and scratchpad | 180–250k tok, ~1–1.5 h | | Sonnet 5.5, medium | not started |
| 7 | Calendar from macOS Calendar | 150–250k tok, ~1–1.5 h | | Opus 5.5, medium | not started |
| 8 | Sunset Linkra | 30–60k tok, ~20 min | | Haiku 5.5 | not started |

Total: roughly 1.3–1.8M tokens, about 8–10 hours of agent time over 8 threads.

### 1. Planner store and Linkra import
Goal: AureliaSpace holds all Linkra data locally.
- Types for goals, today plan, roadmap cards, habits and completions, focus sessions, insights, weekly reviews, journal and scratchpad.
- `planner` state name in `ipc.ts` and Rust; a small store module (`src/store/planner.ts`).
- Settings → Planner: "Import Linkra export" (file picker, reads `linkra-export-*.json` schema v3) and the dev-panel switches.
- Done when: importing `~/Downloads/linkra-export-1773986109051.json` (or a fresh export) shows counts per kind in Settings, and they survive an app restart. Import tests pass.
- Why Sonnet: plain types and a mapping, no hard design.
- Needs: nothing.

### 2. Today
Goal: the start screen shows today's plan and goals, and a goal turns into a thread.
- Today panel on `StartScreen.tsx`: goals with points and a score, today-plan queue, add/tick/reorder.
- "Start thread" on a goal opens a chat thread with the goal as the prompt, in that goal's project.
- Goals roll over at local midnight; Linkra's goal template refills each day.
- Quick capture: a palette command "Capture…" that adds to today or a project.
- "Plan my day" sends one prompt to a chat thread with today's state and writes the reply back as plan items (replaces Build My Plan / Fill My Day).
- Done when: screenshot of `?view=start` with the panel; ticking a goal and starting a thread from one work in the preview harness.
- Needs: 1.

### 3. Roadmap
Goal: each project has a roadmap that moves on its own as work lands.
- Roadmap view per project (four lanes, drag between lanes, card detail).
- Card → thread (worktree optional). The thread stores the card id.
- Write-back: a thread marked Settled, or its PR merged, moves the card to shipped and ticks a linked goal.
- Done when: screenshot of the new `?view=roadmap`; a test proves Settled/merged moves the card.
- Why high effort: the write-back touches thread state and PR wakes (`threads.ts`, `prWake.ts`).
- Needs: 1.

### 4. Habits and focus sessions
Goal: daily habits with streaks, and a focus timer that logs sessions.
- Habit list with today's ticks and streak counts (local-midnight reset, Linkra's UTC bug not carried over).
- Focus timer (Pomodoro lengths from settings) in the title bar or status area; a finished session is logged against a project.
- Done when: screenshots of both; streak and rollover tests pass.
- Needs: 1.

### 5. Signals and daily briefing
Goal: project-health warnings show up where work starts.
- Port `insightsRules.ts` and run it on projects, git activity and roadmap (stale project, nothing in progress, overdue card, open PR waiting).
- Signals show on the Board as suggestions with snooze (24 h / 7 d / forever) and "Start thread".
- Daily briefing card on the start screen, built from signals, today and yesterday's threads (no AI call needed; optional "Summarise" thread).
- Done when: screenshot of `?view=board` with signals; rule tests pass.
- Needs: 1–3.

### 6. Weekly review, journal and scratchpad
Goal: the week closes itself from what actually happened.
- Weekly review built from threads settled, PRs merged, goals scored, habits and focus time (port `weekly.ts`), with notes and "close week".
- Journal entries and a scratchpad per project (a tab in the right panel).
- Done when: screenshot of the review and the right-panel tab; weekly tests pass.
- Needs: 1–4.

### 7. Calendar
Goal: today's events sit beside the plan.
- Rust command reading today's and this week's events through EventKit (asks macOS Calendar permission once; usage string in Tauri config).
- Events on the Today panel and a week view; an event can become a goal or a time-boxed plan item.
- Done when: real events from Calendar.app appear in the Dev app (screenshot), and `npm run app:build:dev` finishes.
- Why Opus: Objective-C bridge from Rust and macOS permission handling, the riskiest part.
- Needs: 2.

### 8. Sunset Linkra
Goal: Linkra is off and archived.
- Final export from the live app, imported and checked against counts.
- Jah confirms each outward step: maintenance switch on, Cloudflare worker and Supabase project paused or deleted, repo set private and archived.
- Done when: AureliaSpace has the final data and Jah has confirmed each step.
- Needs: 1–7 (or whichever Jah wants before switching off).

## Not in scope
- Mobile or web access to the planner.
- Moving Linkra's Agent memory or conversation history (stored in Supabase; can be dumped into the archive in phase 8 if wanted).
