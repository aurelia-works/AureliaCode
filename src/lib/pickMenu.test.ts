import assert from "node:assert/strict";
import { test } from "node:test";
import { anchoredMenuWidth, pickFullText, pickTipTop } from "./pickMenu.ts";

test("the menu width is the room from the trigger to the pane, capped", () => {
  assert.equal(anchoredMenuWidth(658.5, 846), Math.min(330, 846 - 658.5 - 8));
  assert.equal(anchoredMenuWidth(100, 900), 330);
  assert.equal(anchoredMenuWidth(800, 820), 12);
  assert.equal(anchoredMenuWidth(900, 800), 0);
});

test("a different label length does not change the width when the trigger's left stays", () => {
  const left = 628.3;
  const paneRight = 989.6;
  assert.equal(anchoredMenuWidth(left, paneRight), anchoredMenuWidth(left, paneRight));
  assert.equal(anchoredMenuWidth(left, paneRight), Math.min(330, paneRight - left - 8));
});

test("a tooltip sits above its control when that stays inside the pane", () => {
  assert.equal(pickTipTop({ anchorTop: 200, anchorBottom: 228, tipHeight: 24, minTop: 20, maxBottom: 400 }), 170);
  assert.equal(pickTipTop({ anchorTop: 30, anchorBottom: 58, tipHeight: 40, minTop: 20, maxBottom: 400 }), 64);
});

test("a lower-edge model tip stays under the goal actions and off the composer field", () => {
  const top = pickTipTop({
    anchorTop: 340,
    anchorBottom: 368,
    tipHeight: 57,
    minTop: 98,
    maxBottom: 393,
    actionsBottom: 250,
    fieldTop: 291,
    fieldBottom: 332,
  });
  assert.equal(top, 336);
  assert.ok(top >= 250 + 4, "covers the goal actions");
  assert.ok(top >= 332 - 0.5, "covers the composer field");
  assert.ok(top + 57 <= 393 + 0.5, "leaves the pane");
});

test("a row's full text keeps the subtitle", () => {
  assert.equal(pickFullText("Opus", "Most capable, for hard problems"), "Opus. Most capable, for hard problems");
  assert.equal(pickFullText("Haiku", ""), "Haiku");
  assert.equal(pickFullText("Not signed in", "Not signed in"), "Not signed in");
});
