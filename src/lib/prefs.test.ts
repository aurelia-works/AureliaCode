import assert from "node:assert/strict";
import { test } from "node:test";
import { clampUndoSeconds, DEFAULT_PREFS, normalizePrefs } from "./prefs.ts";

test("missing or junk prefs give the defaults", () => {
  assert.deepEqual(normalizePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(normalizePrefs("x"), DEFAULT_PREFS);
});

test("known keys of the right type are kept, wrong types and unknown keys ignored", () => {
  const p = normalizePrefs({ undo: false, pin: "yes", nonsense: true, undoSeconds: 9 });
  assert.equal(p.undo, false);
  assert.equal(p.pin, true);
  assert.equal(p.undoSeconds, 9);
  assert.ok(!("nonsense" in p));
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
