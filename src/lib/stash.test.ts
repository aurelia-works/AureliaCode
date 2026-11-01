import assert from "node:assert/strict";
import { test } from "node:test";
import { scratchName } from "./scratchName.ts";
import { STASH_CAP, stashDraft, toggleStash, unstash } from "./stash.ts";

test("a draft is stashed and comes back newest first", () => {
  let list = stashDraft([], "one");
  list = stashDraft(list, "two");
  assert.deepEqual(unstash(list), { list: ["one"], text: "two" });
  assert.deepEqual(unstash([]), { list: [], text: null });
});

test("blank drafts are not stashed and the stash is capped", () => {
  assert.deepEqual(stashDraft([], "  \n "), []);
  let list: string[] = [];
  for (let i = 0; i < STASH_CAP + 3; i++) list = stashDraft(list, `d${i}`);
  assert.equal(list.length, STASH_CAP);
  assert.equal(list.at(-1), `d${STASH_CAP + 2}`);
});

test("⌘S stashes a draft, then brings it back into an empty box", () => {
  const a = toggleStash([], "my draft");
  assert.deepEqual([a.did, a.text, a.list], ["stashed", "", ["my draft"]]);
  const b = toggleStash(a.list, "");
  assert.deepEqual([b.did, b.text, b.list], ["restored", "my draft", []]);
  assert.equal(toggleStash([], "").did, "nothing");
  assert.equal(toggleStash(["x"], "typing").did, "stashed");
});

test("scratch folder names are safe and dated", () => {
  const n = scratchName(new Date(2026, 9, 28, 12), "A1-b2_c3!");
  assert.equal(n, "2026-10-28-scratch-a1b2c3");
  assert.match(scratchName(new Date(2026, 0, 5), "!!!"), /^2026-01-05-scratch-x$/);
  assert.match(n, /^[A-Za-z0-9-]+$/);
});
