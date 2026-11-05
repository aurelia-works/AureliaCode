import { test } from "node:test";
import assert from "node:assert/strict";
import { OLD_SECTIONS, PARTS, SECTION_DEFS, resolveSectionId, searchSections } from "./settingsIndex.ts";
import { UndoStack, changedKeys } from "./settingsUndo.ts";

test("27 old pages fold into 10 sections, each part once", () => {
  assert.equal(SECTION_DEFS.length, 10);
  const used = SECTION_DEFS.flatMap((s) => [...s.parts, ...(s.folded ?? [])]);
  assert.equal(new Set(used).size, used.length, "no part in two sections");
  assert.deepEqual([...used].sort(), Object.keys(PARTS).sort(), "every part has a section");
});

test("search still finds every old page by its label and each keyword", () => {
  assert.equal(OLD_SECTIONS.length, 27);
  for (const old of OLD_SECTIONS) {
    const words = [old.label, ...old.keywords.split(/\s+/)].filter(Boolean);
    for (const w of words) {
      const hits = searchSections(w).map((s) => s.id);
      assert.ok(old.to.some((id) => hits.includes(id)), `"${w}" (old ${old.id}) should find ${old.to.join(" or ")}, got ${hits.join(",") || "nothing"}`);
    }
  }
});

test("old page ids open the section that holds them", () => {
  assert.equal(resolveSectionId("remote"), "connections");
  assert.equal(resolveSectionId("my-agents"), "agents");
  assert.equal(resolveSectionId("sounds"), "chat");
  assert.equal(resolveSectionId("providers"), "accounts");
  assert.equal(resolveSectionId("diagnostics"), "about");
  assert.equal(resolveSectionId("labs"), "advanced");
  assert.equal(resolveSectionId("threads"), "appearance");
  assert.equal(resolveSectionId("connections"), "connections", "new ids pass through");
  assert.equal(resolveSectionId("nope"), "general", "unknown falls back to the first");
  assert.equal(resolveSectionId(null), "general");
  for (const old of OLD_SECTIONS) assert.ok(SECTION_DEFS.some((s) => s.id === resolveSectionId(old.id)), old.id);
});

test("undo steps back one change at a time, newest first", () => {
  const u = new UndoStack();
  u.push("config", { a: 1 }, { a: 2 }, 0);
  u.push("prefs", { p: false }, { p: true }, 5000);
  assert.equal(u.size, 2);
  assert.deepEqual(u.undo(), { kind: "prefs", before: { p: false }, after: { p: true }, at: 5000, key: "p" });
  assert.deepEqual(u.undo()?.before, { a: 1 });
  assert.equal(u.undo(), undefined);
});

test("typing in one field is one undo step; another field is its own step", () => {
  const u = new UndoStack();
  u.push("config", { name: "" }, { name: "a" }, 0);
  u.push("config", { name: "a" }, { name: "ab" }, 300);
  u.push("config", { name: "ab" }, { name: "abc" }, 600);
  assert.equal(u.size, 1, "same field within a second merges");
  u.push("config", { name: "abc", port: 1 }, { name: "abc", port: 2 }, 900);
  assert.equal(u.size, 2, "a different field is a new step");
  u.push("config", { name: "abc", port: 2 }, { name: "abc", port: 3 }, 5000);
  assert.equal(u.size, 3, "the same field after a pause is a new step");
  u.undo();
  u.undo();
  assert.deepEqual(u.undo(), { kind: "config", before: { name: "" }, after: { name: "abc" }, at: 600, key: "name" });
});

test("no-op changes are not recorded, and the stack keeps the last 50", () => {
  const u = new UndoStack();
  u.push("config", { a: 1 }, { a: 1 }, 0);
  assert.equal(u.size, 0);
  for (let i = 0; i < 80; i++) u.push("prefs", { n: i }, { n: i + 1 }, i * 2000);
  assert.equal(u.size, 50);
  assert.deepEqual(u.undo()?.after, { n: 80 });
});

test("changedKeys names the top-level fields that differ", () => {
  assert.deepEqual(changedKeys({ a: 1, b: { c: 1 } }, { a: 1, b: { c: 2 } }), ["b"]);
  assert.deepEqual(changedKeys({ a: 1 }, { a: 1, z: 0 }), ["z"]);
  assert.deepEqual(changedKeys({ a: 1 }, { a: 1 }), []);
});
