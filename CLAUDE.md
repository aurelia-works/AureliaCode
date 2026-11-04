# AureliaCode

Tauri 2 app: React + TypeScript front end in `src/`, Rust back end in `src-tauri/`.

## Verification

A task is not done until these have run on the final code and their output is in your reply.
Paste the result lines (pass/fail counts, errors), not the whole log.

| Step | Command | Done when |
| --- | --- | --- |
| Type check (the lint step; no ESLint or Prettier is set up) | `npx tsc --noEmit -p .` | no output |
| Front-end tests | `npm test` | `fail 0` |
| Back-end tests | `cargo test --manifest-path src-tauri/Cargo.toml` | every `test result: ok` |
| Web build | `npm run build` | `built in` |
| App build (when Rust, Tauri config or bundling changed) | `npm run app:build:dev` | `Finished 1 bundle` |

Run the tests before you edit too, so a failure that was already there isn't blamed on the change.
If a step fails or is skipped, say which and why. Never call a task done with a red step.

### UI changes need a screenshot

Any change to `src/components/`, `src/styles/` or anything else on screen needs a screenshot check:

1. `npx vite --port 1437 --strictPort` (any free port; 1420 belongs to `tauri dev`).
2. Open `http://localhost:1437/design/preview/?view=<view>` with Playwright and take a screenshot.
   Views: `threads` (`&single=1`, `&rail=changes`), `chat`, `start`, `board`, `review`,
   `settings` (`&section=accounts`), `palette`, `files`, `terminals`.
3. Look at the screenshot, and say in your reply what you checked and which view.

The harness (`design/preview/mock.ts`) mocks the Tauri IPC. Add a view there when a screen has none.

For a PR, `npm run shots` captures before (merge base) and after shots of the views the diff touches
(`src/lib/previewViews.ts` maps files to views; `--views a,b` overrides). `--publish` pushes them to the
`pr-shots` branch and prints the table for the PR's Screenshots section. With a before, a Changes
shot boxes and numbers each changed area, and a legend under the table says where each one is.

`npm run ui-score -- <views>` scores the after shots against `design/review/UI-RUBRIC.md` with Haiku
(one model call, about 30 s) and prints `SCORE: n/10`. It can be a thread goal's check.

## Review

- Reviews follow [REVIEW.md](REVIEW.md).
- Before opening a PR, run `/code-review` on the branch diff and fix what it finds.
- At most 3 review rounds. After the third, stop reviewing the whole diff: re-scope to what
  changed since the last round (`git diff <last reviewed commit>..HEAD`) and review only that.
- PRs use [.github/pull_request_template.md](.github/pull_request_template.md): Testing, Risk, How to revert.

## Current project
Agent IDE: see PLAN-AGENT-IDE.md and HANDOFF-2026-11-04-PHASE-0.md. Earlier rebrand plan: PLAN-AURELIACODE.md (Phase 3 still todo).
