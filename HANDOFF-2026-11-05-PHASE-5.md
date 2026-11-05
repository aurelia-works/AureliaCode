# Handoff: UI pass, Phase 5 of 6, greeting wordmark (2026-11-05)

Plan: `PLAN.md` in the main checkout. Branch `feat/greeting-wordmark`, worktree `../AureliaCode-greeting`, from origin/main 69cb549.

## Done
- Title bar: "AureliaCode" in Instrument Serif italic (20 px, "Code" faint) replaces the jellyfish mark and the sans name (`src/components/Wordmark.tsx`). The menu-bar squid is unchanged.
- On the hour the letters blur out one by one while "Morning, Jah" / "Afternoon, Jah" / "Evening, Jah" blur in; the box eases to the new width; it holds (default 6 s) and morphs back. One timeout per hour, nothing ticks in between.
- Reduce motion (macOS or Appearance → Reduce motion): it swaps without the morph.
- Dev panel, Appearance → Wordmark: Hourly greeting switch, Hold slider (2-20 s), Name, Play it now. Prefs `greeting`, `greetingHoldS`, `greetingName` in ui.json.
- `src/lib/greeting.ts` + test: the greeting for each of the 24 hours (0-4 and 18-23 Evening, 5-11 Morning, 12-17 Afternoon), name trimming, the next top of the hour, the hold clamp.
- Preview: `?view=threads&greet=1` plays it 0.8 s after load.
- Dead CSS removed: `.brand-mark` (the mark is gone) and `.brand-name span`.

## Not tested
- The real app: the hourly timer over a real hour, sleep/wake (a timer that fires late plays late once, then re-arms), and the font in WKWebView. Only the preview (Chromium), tests and build.
- DST nights: the fall-back repeated hour may be skipped (review note, harmless).

## Next
- PR waiting on Jah. Phase 6: Background inbox.
