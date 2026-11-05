# Handoff: UI pass, Phase 1 of 6, Visual replies in the thread (2026-11-05)

Plan: `PLAN.md` in the main checkout (the UI pass plan; uncommitted there). Branch `feat/visual-replies`, worktree `../AureliaCode-visual`, from origin/main 69cb549.

## Done
- An `aurelia_show_html` page now draws as a card in a chat, above the written reply and outside the folded work.
  - It reads the page from the tool call's own input, so a reopened chat keeps it.
  - Iframe `sandbox="allow-scripts"` only (opaque origin: no app storage, IPC, popups or top navigation).
  - The app's tokens (`--bg`, `--surface`, `--text`, `--accent`, `--font-ui` …) are injected ahead of the page's own head, so the page's styles win. Theme changes are posted in without a reload.
  - Height follows the page (120-520 px). Expand opens a full overlay (Esc or the button returns). The globe button opens the served copy in a browser pane. Links open in the system browser.
- Rust: `show_html` reaches the frontend as `{url, title}`, without the page. A chat pane no longer opens a browser pane; a terminal pane still does (`src/lib/control.ts`).
- Tool description tells agents about the card and the CSS variables (`src-tauri/src/orchestrator.rs`).
- Preview: `?view=chat&visual=1`; `previewViews.ts` maps the new files to it.
- Files: `src/lib/visualReply.ts` (+ test), `src/components/VisualReply.tsx`, `ChatPane.tsx` (WorkBlock), `deep.css`, `control.rs` (+ test).

## Evidence
- `npx tsc --noEmit -p .`: no output. `npm test`: pass 401, fail 0 (8 new). `cargo test`: 192 passed (1 new). `npm run build`: built in 237ms. `npm run app:build:dev`: Finished 1 bundle.
- Haiku Playwright check: 10/10 PASS (sandbox, theme var, height 214 px, card above answer, expand 815 px, Esc closes, live theme follow, no console errors).
- GIFs: `.shots/pr/chat-visual-1-clip.gif` (static view), `.shots/pr/visual-reply-expand.gif` (card → expand → back).

## Not tested
- The real app with a real agent calling `aurelia_show_html` (only the preview mock and tests).
- Codex chats: the name match accepts `aurelia.aurelia_show_html`; I didn't see a real Codex call's name.
- Light theme and high contrast in the card (only the dark default was looked at).
- Pages that load scripts from a CDN: allowed (no CSP added), not tried.

## Known
- Pre-existing harness quirk: in `?view=chat`, the mocked "Morning triage" routine fires about 5 s after load and switches to its own thread. Screenshots must be taken before that.
- No settings switch for visual replies. It's on by default, per Jah's decision 1 (no switches for on-by-default features).

## Next
- Waiting on Jah: push and open the PR (skill `ship`, after `/code-review`).
- Then Phase 2, Grid squeeze and toast overlap, in a fresh session.
