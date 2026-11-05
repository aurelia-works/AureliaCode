import { test } from "node:test";
import assert from "node:assert/strict";
import { SPLASH_INTRO_MS, splashDelay } from "./splash.ts";

test("a fast boot does not cut the splash intro off", () => {
  // The perf pass can paint the app in ~200 ms; the inline intro runs for 900 ms.
  assert.equal(splashDelay(0, 200, false), SPLASH_INTRO_MS - 200);
  assert.equal(splashDelay(0, 0, false), SPLASH_INTRO_MS);
  assert.equal(splashDelay(0, SPLASH_INTRO_MS, false), 0);
  assert.equal(splashDelay(0, 2000, false), 0);
});

test("the setting adds a hold after the intro, never shortens it", () => {
  assert.equal(splashDelay(1600, 200, false), 1400);
  assert.equal(splashDelay(500, 200, false), SPLASH_INTRO_MS - 200, "a smaller setting still lets the intro finish");
  assert.equal(splashDelay(9000, 0, false), 3000, "clamped like prefs");
});

test("reduced motion has no intro to wait for", () => {
  assert.equal(splashDelay(0, 0, true), 0);
  assert.equal(splashDelay(2000, 0, true), 0);
});
