import { test } from "node:test";
import assert from "node:assert/strict";
import { diffBoxes, legendLine } from "./shotDiff.ts";

/** A grid from rows of "." and "#". */
const grid = (rows: string[]) => ({ mask: Uint8Array.from(rows.join("").split(""), (c) => (c === "#" ? 1 : 0)), cols: rows[0].length, rows: rows.length });

test("no changed cells, no boxes", () => {
  const g = grid(["....", "...."]);
  assert.deepEqual(diffBoxes(g.mask, g.cols, g.rows), { boxes: [], more: 0 });
});

test("separate changes get separate boxes, biggest first", () => {
  const g = grid([
    "##......",
    "##......",
    "........",
    "......#.",
  ]);
  assert.deepEqual(diffBoxes(g.mask, g.cols, g.rows).boxes, [
    { x: 0, y: 0, w: 2, h: 2 },
    { x: 6, y: 3, w: 1, h: 1 },
  ]);
});

test("cells a gap apart join one box, so a reworded line isn't five callouts", () => {
  const g = grid(["#.#.#...", "........"]);
  assert.deepEqual(diffBoxes(g.mask, g.cols, g.rows, 1).boxes, [{ x: 0, y: 0, w: 5, h: 1 }]);
  assert.equal(diffBoxes(g.mask, g.cols, g.rows, 0).boxes.length, 3);
});

test("past the cap the smallest are counted, not drawn", () => {
  const g = grid(["#.#.#.#.", "........", "#.#.#.#."]);
  const r = diffBoxes(g.mask, g.cols, g.rows, 0, 5);
  assert.equal(r.boxes.length, 5);
  assert.equal(r.more, 3);
});

test("the legend gives CSS pixels and where on screen", () => {
  // 16-px cells on a 2x screenshot of a 1440x900 viewport: one cell is 8 CSS px.
  assert.equal(legendLine(1, { x: 10, y: 100, w: 40, h: 6 }, 8, 1440, 900), "1. 320×48 at (80, 800), bottom left");
  assert.equal(legendLine(2, { x: 160, y: 2, w: 10, h: 4 }, 8, 1440, 900), "2. 80×32 at (1280, 16), top right");
  assert.equal(legendLine(3, { x: 80, y: 50, w: 10, h: 10 }, 8, 1440, 900), "3. 80×80 at (640, 400), middle");
});
