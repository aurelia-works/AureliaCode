import { test } from "node:test";
import assert from "node:assert/strict";
import { gridFits, layoutMinWidth, PANE_MIN_WIDTH } from "./gridFit.ts";
import type { LayoutNode } from "../store/layout.ts";

const pane = (id: string): LayoutNode => ({ type: "pane", id });
let n = 0;
const row = (a: LayoutNode, b: LayoutNode, ratio = 0.5): LayoutNode => ({ type: "split", id: `r${n++}`, dir: "row", ratio, a, b });
const col = (a: LayoutNode, b: LayoutNode, ratio = 0.5): LayoutNode => ({ type: "split", id: `c${n++}`, dir: "column", ratio, a, b });

// The preview's six-thread tab: three columns of two, made of nested row splits (1/3 + 2/3 of 1/2 each).
const sixGrid = row(col(pane("a"), pane("d")), row(col(pane("b"), pane("e")), col(pane("c"), pane("f"))), 1 / 3);

test("one pane needs only the pane minimum", () => {
  assert.equal(layoutMinWidth(pane("a")), PANE_MIN_WIDTH);
  assert.equal(PANE_MIN_WIDTH, 260);
});

test("stacked panes don't add width", () => {
  assert.equal(layoutMinWidth(col(pane("a"), pane("b"))), 260);
});

test("side by side panes add up, honouring the split ratio", () => {
  assert.equal(layoutMinWidth(row(pane("a"), pane("b"))), 520);
  // A 25/75 split needs 1040 px so the narrow side still gets 260.
  assert.equal(layoutMinWidth(row(pane("a"), pane("b"), 0.25)), 1040);
});

test("three columns need 780 px", () => {
  assert.ok(Math.abs(layoutMinWidth(sixGrid) - 780) < 0.5, String(layoutMinWidth(sixGrid)));
});

test("the six-thread grid fits a wide stage but not one squeezed by the Changes rail", () => {
  assert.equal(gridFits(sixGrid, 1150), true, "rail closed");
  assert.equal(gridFits(sixGrid, 490), false, "rail open at 1440 px: about 490 px left");
});

test("a single pane always fits, and an unmeasured stage (0) counts as fitting", () => {
  assert.equal(gridFits(pane("a"), 120), true);
  assert.equal(gridFits(sixGrid, 0), true);
});

test("a ratio dragged to the edge doesn't divide by zero", () => {
  assert.ok(Number.isFinite(layoutMinWidth(row(pane("a"), pane("b"), 0))));
  assert.ok(Number.isFinite(layoutMinWidth(row(pane("a"), pane("b"), 1))));
});
