/**
 * Launch splash timing. The inline splash in index.html is already playing its entrance
 * animation before the bundle loads; the app may paint sooner than that animation ends
 * (the 2026-11-05 perf pass made boot ~5x faster), so hiding on first paint alone cut the
 * animation off and looked like a flicker. The intro always gets its time; the user setting
 * only adds a hold after it. Reduced motion skips the wait because there is no intro to see.
 */
export const SPLASH_INTRO_MS = 900;

export function splashDelay(minMs: number, elapsedMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  const target = Math.max(SPLASH_INTRO_MS, Math.min(3000, Math.max(0, minMs)));
  return Math.max(0, target - Math.max(0, elapsedMs));
}
