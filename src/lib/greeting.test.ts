import { test } from "node:test";
import assert from "node:assert/strict";
import { clampHoldSeconds, greetingFor, msUntilNextHour, partOfDay } from "./greeting.ts";
import { DEFAULT_PREFS, normalizePrefs } from "./prefs.ts";

test("every hour of the day has its greeting", () => {
  const want = [
    "Evening", "Evening", "Evening", "Evening", "Evening", // 0-4: still last night
    "Morning", "Morning", "Morning", "Morning", "Morning", "Morning", "Morning", // 5-11
    "Afternoon", "Afternoon", "Afternoon", "Afternoon", "Afternoon", "Afternoon", // 12-17
    "Evening", "Evening", "Evening", "Evening", "Evening", "Evening", // 18-23
  ];
  assert.equal(want.length, 24);
  for (let h = 0; h < 24; h++) {
    assert.equal(partOfDay(h), want[h], `hour ${h}`);
    assert.equal(greetingFor(h, "Jah"), `${want[h]}, Jah`, `hour ${h}`);
  }
});

test("no name gives the bare greeting; spaces are trimmed", () => {
  assert.equal(greetingFor(9, ""), "Morning");
  assert.equal(greetingFor(9, "   "), "Morning");
  assert.equal(greetingFor(14, "  Jah "), "Afternoon, Jah");
});

test("the next top of the hour", () => {
  assert.equal(msUntilNextHour(new Date(2026, 10, 5, 9, 59, 59, 500)), 500);
  assert.equal(msUntilNextHour(new Date(2026, 10, 5, 9, 0, 0, 0)), 3_600_000, "exactly on the hour waits for the next one");
  assert.equal(msUntilNextHour(new Date(2026, 10, 5, 23, 30, 0, 0)), 1_800_000, "across midnight");
});

test("the hold is 2-20 s, whole seconds, 6 by default", () => {
  assert.equal(DEFAULT_PREFS.greetingHoldS, 6);
  assert.equal(DEFAULT_PREFS.greeting, true);
  assert.equal(DEFAULT_PREFS.greetingName, "Jah");
  assert.equal(clampHoldSeconds(0), 2);
  assert.equal(clampHoldSeconds(99), 20);
  assert.equal(clampHoldSeconds(7.4), 7);
  assert.equal(clampHoldSeconds(NaN), 6);
  assert.equal(normalizePrefs({ greetingHoldS: 50 }).greetingHoldS, 20);
  assert.equal(normalizePrefs({ greetingHoldS: "x" }).greetingHoldS, 6);
  assert.equal(normalizePrefs({ greeting: false }).greeting, false);
  assert.equal(normalizePrefs({ greetingName: "Sam" }).greetingName, "Sam");
});
