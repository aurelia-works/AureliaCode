import assert from "node:assert/strict";
import { test } from "node:test";
import { clampUndoSeconds, DEFAULT_PREFS, normalizePrefs } from "./prefs.ts";

test("missing or junk prefs give the defaults", () => {
  assert.deepEqual(normalizePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(normalizePrefs("x"), DEFAULT_PREFS);
});

test("known keys of the right type are kept, wrong types and unknown keys ignored", () => {
  const p = normalizePrefs({ navRight: true, council: "yes", nonsense: true, undoSeconds: 9 });
  assert.equal(p.navRight, true);
  assert.equal(p.council, true);
  assert.equal(p.undoSeconds, 9);
  assert.ok(!("nonsense" in p));
});

test("an old file's switches for always-on features are dropped, so the features stay on", () => {
  const p = normalizePrefs({ undo: false, pin: false, diffTripwire: false, oneHeader: false, steerKey: false });
  for (const k of ["undo", "pin", "diffTripwire", "oneHeader", "steerKey"]) assert.ok(!(k in p), k);
});

test("follow-up mode accepts queue or steer only", () => {
  assert.equal(DEFAULT_PREFS.followUp, "queue");
  assert.equal(normalizePrefs({ followUp: "steer" }).followUp, "steer");
  assert.equal(normalizePrefs({ followUp: "later" }).followUp, "queue");
});

test("undo seconds is clamped to 2..30", () => {
  assert.equal(normalizePrefs({ undoSeconds: 0 }).undoSeconds, 2);
  assert.equal(normalizePrefs({ undoSeconds: 999 }).undoSeconds, 30);
  assert.equal(normalizePrefs({ undoSeconds: NaN }).undoSeconds, 5);
});

test("a typed undo window is clamped, and junk keeps the old value", () => {
  assert.equal(clampUndoSeconds("10", 5), 10);
  assert.equal(clampUndoSeconds("1", 5), 2);
  assert.equal(clampUndoSeconds("99", 5), 30);
  assert.equal(clampUndoSeconds("", 5), 5);
  assert.equal(clampUndoSeconds("abc", 7), 7);
  assert.equal(clampUndoSeconds(4.6, 5), 5);
});

test("new-thread defaults and the fallback are kept as text; anything else is dropped", () => {
  const p = normalizePrefs({ newModel: "sonnet", newEffort: "high", fallback: "opencode:x/y" });
  assert.equal(p.newModel, "sonnet");
  assert.equal(p.newEffort, "high");
  assert.equal(p.fallback, "opencode:x/y");
  const bad = normalizePrefs({ newModel: 3, fallback: true });
  assert.equal(bad.newModel, "");
  assert.equal(bad.fallback, "");
});

test("review numbers are kept in range and the council model list stays a string", () => {
  const p = normalizePrefs({ readyScore: 14, reviewRoundCap: -2, councilModels: "opencode-go/kimi-k2", followUp: "nonsense" });
  assert.equal(p.readyScore, 10);
  assert.equal(p.reviewRoundCap, 0);
  assert.equal(p.councilModels, "opencode-go/kimi-k2");
  assert.equal(p.followUp, DEFAULT_PREFS.followUp);
  assert.equal(normalizePrefs({ readyScore: "9" }).readyScore, DEFAULT_PREFS.readyScore);
});

test("the nightly review is off by default and its hour stays a whole hour of the day", () => {
  assert.equal(normalizePrefs({}).nightlyReview, false);
  assert.equal(normalizePrefs({ nightlyHour: 30 }).nightlyHour, 23);
  assert.equal(normalizePrefs({ nightlyHour: 4.6 }).nightlyHour, 5);
  assert.equal(normalizePrefs({ nightlyHour: "3" }).nightlyHour, 3, "not a number: the default");
});

test("the splash hold is saved, clamped and 0 by default; the intro itself is in lib/splash", () => {
  assert.equal(normalizePrefs({}).splashMinMs, 0);
  assert.equal(normalizePrefs({ splashMinMs: 1600 }).splashMinMs, 1600);
  assert.equal(normalizePrefs({ splashMinMs: 9000 }).splashMinMs, 3000);
  assert.equal(normalizePrefs({ splashMinMs: -5 }).splashMinMs, 0);
  assert.equal(normalizePrefs({ splashMinMs: "800" }).splashMinMs, 0, "not a number: the default");
});

test("desktop computer use is off by default and stays a boolean", () => {
  assert.equal(DEFAULT_PREFS.computerUse, false);
  assert.equal(normalizePrefs({ computerUse: true }).computerUse, true);
  assert.equal(normalizePrefs({ computerUse: "yes" }).computerUse, false);
});

test("new threads start at Medium effort; a file saved before that moves to Medium once", () => {
  assert.equal(DEFAULT_PREFS.newEffort, "medium");
  assert.equal(normalizePrefs(undefined).newEffort, "medium");
  const old = normalizePrefs({ newEffort: "" });
  assert.equal(old.newEffort, "medium", "the old default (follow Auto effort) becomes Medium");
  assert.equal(old.effortMoved, true);
  assert.equal(normalizePrefs({ newEffort: "high" }).newEffort, "high", "an effort you picked stays");
  assert.equal(normalizePrefs({ newEffort: "", effortMoved: true }).newEffort, "", "Auto picked again after the move sticks");
});
