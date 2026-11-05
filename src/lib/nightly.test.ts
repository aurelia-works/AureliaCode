import assert from "node:assert/strict";
import { test } from "node:test";
import { isDue, nextFolder, overnight } from "./nightly.ts";

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();

test("due once a night: after the hour, if it hasn't run since that hour", () => {
  assert.equal(isDue(at(5, 2, 59), undefined, 3), false, "before 3am on the first night");
  assert.equal(isDue(at(5, 3, 0), undefined, 3), true);
  assert.equal(isDue(at(5, 9, 0), at(5, 3, 10), 3), false, "already ran tonight");
  assert.equal(isDue(at(6, 1, 0), at(5, 3, 10), 3), false, "next night's hour hasn't come");
  assert.equal(isDue(at(6, 14, 0), at(5, 3, 10), 3), true, "app was closed at 3am: catch up when it opens");
});

test("folders rotate in order and wrap, and a vanished folder restarts the rotation", () => {
  const f = ["", "src", "src/lib"];
  assert.equal(nextFolder(f, undefined), "");
  assert.equal(nextFolder(f, ""), "src");
  assert.equal(nextFolder(f, "src/lib"), "");
  assert.equal(nextFolder(f, "gone"), "");
  assert.equal(nextFolder([], "x"), undefined);
});

test("only important findings two reviewers agree on are kept for the morning", () => {
  const a = "- [important] src/a.ts:10 - off by one\n- [nit] src/a.ts:3 - name\n- [important] src/b.ts:5 - only I saw this\nSCORE: 6/10\nVERDICT: fix";
  const b = "- [important] src/a.ts:11 - loop runs one past the end\nSCORE: 7/10\nVERDICT: fix";
  const out = overnight([{ model: "m1", text: a, failed: false, seconds: 1 }, { model: "m2", text: b, failed: false, seconds: 1 }]);
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].file, "src/a.ts");
  assert.equal(out.score, 6.5);
  assert.equal(out.reviewers, 2);
});

test("failed reviewers don't count", () => {
  const out = overnight([{ model: "m1", text: "boom", failed: true, seconds: 0 }]);
  assert.equal(out.reviewers, 0);
  assert.deepEqual(out.findings, []);
});

test("code two reviewers agree can be deleted is kept, tagged delete", () => {
  const a = "- [delete] src/old.ts:1 - exportedHelper has no callers\n- [delete] src/x.ts:9 - only I think so\nSCORE: 8/10\nVERDICT: ship";
  const b = "- [delete] src/old.ts:2 - unused export exportedHelper\nSCORE: 8/10\nVERDICT: ship";
  const out = overnight([{ model: "m1", text: a, failed: false, seconds: 1 }, { model: "m2", text: b, failed: false, seconds: 1 }]);
  assert.deepEqual(out.findings.map((f) => [f.tag, f.file, f.line]), [["delete", "src/old.ts", 1]]);
});

test("a place one reviewer calls a bug and another calls deletable is a bug", () => {
  const a = "- [delete] src/a.ts:10 - unused branch\nSCORE: 7/10";
  const b = "- [important] src/a.ts:10 - this branch swallows the error\nSCORE: 6/10";
  const out = overnight([{ model: "m1", text: a, failed: false, seconds: 1 }, { model: "m2", text: b, failed: false, seconds: 1 }]);
  assert.deepEqual(out.findings.map((f) => f.tag), ["important"]);
});
