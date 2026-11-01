import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOSED_CAP, popClosed, pushClosed, snapshot } from "./closed.ts";
import { latestEntry, liveEntries, makeEntry, previous, pushEntry, undoLabel, withoutEntry } from "./undo.ts";

test("an entry is offered for its window and then expires", () => {
  const e = makeEntry("Settled 1 thread", () => {}, 1000, 5000);
  assert.equal(latestEntry([e], 5999)?.id, e.id);
  assert.equal(latestEntry([e], 6000), undefined);
  assert.equal(liveEntries([e], 6001).length, 0);
});

test("the newest live entry is the one ⌘Z undoes; expired ones drop on push", () => {
  const a = makeEntry("a", () => {}, 0, 5000);
  const b = makeEntry("b", () => {}, 4000, 5000);
  let list = pushEntry(pushEntry([], a, 0), b, 4000);
  assert.equal(latestEntry(list, 4500)?.label, "b");
  assert.equal(latestEntry(list, 5500)?.label, "b", "a has expired but b is still live");
  list = pushEntry(list, makeEntry("c", () => {}, 10_000, 5000), 10_000);
  assert.deepEqual(list.map((e) => e.label), ["c"]);
  assert.deepEqual(withoutEntry(list, list[0].id), []);
});

test("labels read naturally", () => {
  assert.equal(undoLabel("Closed", 1), "Closed 1 thread");
  assert.equal(undoLabel("Settled", 3), "Settled 3 threads");
});

test("previous() remembers what a patch overwrites, including unset keys", () => {
  const meta = { settled: false, snoozedUntil: undefined as number | undefined, cwd: "/x" };
  const prev = previous(meta, { settled: true, snoozedUntil: 5 });
  assert.deepEqual(prev, { settled: false, snoozedUntil: undefined });
  assert.ok("snoozedUntil" in prev);
});

test("snapshot keeps what reopening needs and skips start tabs and editors", () => {
  const s = snapshot({ id: "p", cwd: "/a", account: "claude", mode: "chat", claudeSession: "uuid", chatModel: "opus", settled: true, snoozedUntil: 9 })!;
  assert.equal(s.cwd, "/a");
  assert.deepEqual(s.carry, { claudeSession: "uuid", chatModel: "opus" }, "settled is not carried: reopening must not re-settle");
  assert.equal(snapshot({ launcher: true }), null);
  assert.equal(snapshot({ editor: { path: "x" } }), null);
  assert.equal(snapshot({ browser: { url: "https://x" } })!.browserUrl, "https://x");
});

test("closed threads stack newest last, pop newest first, and are capped", () => {
  let list = pushClosed([], [snapshot({ cwd: "/1" })], 1);
  list = pushClosed(list, [snapshot({ cwd: "/2" }), snapshot({ launcher: true })], 2);
  assert.equal(list.length, 2);
  assert.equal(list[1].panes.length, 1, "the start tab is not recorded");
  assert.equal(pushClosed(list, [null], 3), list);
  const { list: rest, group } = popClosed(list);
  assert.equal(group!.panes[0].cwd, "/2");
  assert.equal(rest.length, 1);
  assert.equal(popClosed([]).group, undefined);
  let many: ReturnType<typeof pushClosed> = [];
  for (let i = 0; i < CLOSED_CAP + 5; i++) many = pushClosed(many, [snapshot({ cwd: `/${i}` })], i);
  assert.equal(many.length, CLOSED_CAP);
  assert.equal(many.at(-1)!.panes[0].cwd, `/${CLOSED_CAP + 4}`);
});
