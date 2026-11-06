import assert from "node:assert/strict";
import { test } from "node:test";
import { anchoredMenuWidth, pickFullText } from "./pickMenu.ts";

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

test("a row's full text keeps the subtitle", () => {
  assert.equal(pickFullText("Opus", "Most capable, for hard problems"), "Opus. Most capable, for hard problems");
  assert.equal(pickFullText("Haiku", ""), "Haiku");
  assert.equal(pickFullText("Not signed in", "Not signed in"), "Not signed in");
});
