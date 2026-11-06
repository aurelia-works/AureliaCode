import assert from "node:assert/strict";
import { test } from "node:test";
import { briefScrollDelta, nextBriefScrollTop } from "./briefScroll.ts";

test("PageDown, ArrowDown and Space move a card that has more below", () => {
  for (const key of ["PageDown", "ArrowDown", " "]) {
    const delta = briefScrollDelta(key, false, 113);
    assert.equal(typeof delta, "number");
    assert.ok((delta as number) > 0, key);
    const next = nextBriefScrollTop(0, delta as number, 311, 113);
    assert.ok(next > 0 && next <= 311 - 113, `${key} -> ${next}`);
  }
});

test("PageUp, ArrowUp and Shift+Space move back, and the ends stop at the card", () => {
  assert.equal(nextBriefScrollTop(40, briefScrollDelta("PageUp", false, 113) as number, 311, 113), 0);
  assert.ok((nextBriefScrollTop(80, briefScrollDelta("ArrowUp", false, 113) as number, 311, 113)) < 80);
  assert.equal(nextBriefScrollTop(40, briefScrollDelta(" ", true, 113) as number, 311, 113), 0);
  assert.equal(nextBriefScrollTop(10, "start", 311, 113), 0);
  assert.equal(nextBriefScrollTop(0, "end", 311, 113), 311 - 113);
  assert.equal(nextBriefScrollTop(311 - 113, briefScrollDelta("PageDown", false, 113) as number, 311, 113), 311 - 113);
});

test("a key that is not a scroll leaves the card alone", () => {
  assert.equal(briefScrollDelta("Enter", false, 113), null);
  assert.equal(briefScrollDelta("Tab", false, 113), null);
  assert.equal(briefScrollDelta("a", false, 113), null);
});
