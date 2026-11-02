# AureliaCode: handoff after Phase 0 (2026-11-02)

## Built
- `design/AURELIACODE-TEARDOWN.md`: LeanREA teardown of PandaCode, Grok Bot, T3 Code (installed apps, static only) + CLIProxyAPI gist summary + terms risk.
- `PLAN-AURELIACODE.md`: phases 1-3, approved by Jah 2026-11-02.
No code changed. Both files are untracked; they go in the Phase 1 WIP commit.

## Decisions
- AureliaSpace -> AureliaCode; references only from other apps (no code/assets copied).
- Terminal UI removed completely.
- Repo moves to `~/Downloads/PROJECTS/GITHUB REPOS/AureliaCode`; GitHub repo renamed `aurelia-works/AureliaCode`.
- Rename + re-sign happen first in Phase 1 (bundle id now `space.aurelia.terminal`).
- CLIProxyAPI routes the Claude subscription: Jah accepted the reported ToS/ban risk. Must be switchable off.
- Privacy: Keychain, no telemetry, local-only data, streamer blur (3 s hover slow unblur, or click).
- Squid icon drawn by the agent; looks on the dev panel.

## Repo state
`~/Downloads/AureliaSpace`, branch `feat/agent-harness`, HEAD f4d6a51, 47 uncommitted files (T3-quiet shell work, gates were green per HANDOFF.md) + the two Phase 0 files.

## Phase 1 starts here
1. Read only: this file, `PLAN-AURELIACODE.md` (Phase 1 section), `design/AURELIACODE-TEARDOWN.md` (layout), `CLAUDE.md` (Verification).
2. Check no other agent is working in the repo (`aurelia_list_panes`, `git status`).
3. `git status --short`, commit WIP on `feat/agent-harness` (no build output), push. Jah approved this commit in the Phase 0 Q&A.
4. Then move, rename, re-sign, terminal out, chat-first window per PLAN.

## Known faults
- Chat select-all/copy broken in AureliaSpace (Jah report, not reproduced).
- Two old SIGABRT crashes (Oct 24 build) undiagnosed.
- Scout scratch copies remain in `$TMPDIR/re/`.
