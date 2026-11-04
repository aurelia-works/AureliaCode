import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { CATEGORIES, parseMin, parseScorecard, scorePrompt } from "./uiScore.ts";

const card = (scores: number[]) => CATEGORIES.map((c, i) => `${c}: ${scores[i]}/10 - because`).join("\n");

test("the overall score is the mean of the categories, not the model's own sum", () => {
  const r = parseScorecard(`${card([8, 7, 6, 9, 8, 7, 8, 9])}\nOVERALL: 10/10`);
  assert.equal(r.missing.length, 0);
  assert.equal(r.score, 7.8);
  assert.equal(r.categories.Typography, 8);
});

test("a missing category is reported and scores the card 0, so a lazy review can't pass", () => {
  const text = card([8, 8, 8, 8, 8, 8, 8, 8]).split("\n").slice(1).join("\n");
  const r = parseScorecard(text);
  assert.deepEqual(r.missing, ["Typography"]);
  assert.equal(r.score, 0);
});

test("markdown around the lines is fine; the last line per category wins", () => {
  const r = parseScorecard(`**Typography:** 3/10\n- **Typography**: 6.5 / 10 (fixed)\n${card([8, 8, 8, 8, 8, 8, 8, 8]).split("\n").slice(1).join("\n")}`);
  assert.equal(r.categories.Typography, 6.5);
});

test("the prompt names every image, every category and the line format", () => {
  const p = scorePrompt([".shots/score/chat-after.png", ".shots/score/start-after.png"], "rubric text");
  for (const bit of [".shots/score/chat-after.png", ".shots/score/start-after.png", "rubric text", ...CATEGORIES, "Typography: n/10"]) assert.ok(p.includes(bit), bit);
});

test("a FIX line that mentions a score doesn't change the category", () => {
  const r = parseScorecard(`${card([8, 8, 3, 8, 8, 8, 8, 8])}\nFIX: Spacing 9/10 is reachable with one scale`);
  assert.equal(r.categories.Spacing, 3);
});

test("a numbered reply still scores every category", () => {
  const r = parseScorecard(CATEGORIES.map((c, i) => `${i + 1}. ${c}: 7/10 - because`).join("\n"));
  assert.deepEqual(r.missing, []);
  assert.equal(r.score, 7);
});

test("a wrapped reason that mentions a score doesn't change the category", () => {
  const r = parseScorecard(`${card([8, 8, 4, 8, 8, 8, 8, 8])}\n  Spacing 9/10 with one scale`);
  assert.equal(r.categories.Spacing, 4);
});

test("an indented line under a category, bullet and colon included, doesn't rescore it", () => {
  const r = parseScorecard(`${card([8, 8, 4, 8, 8, 8, 8, 8])}\n  - Spacing: 9/10 reachable with one scale`);
  assert.equal(r.categories.Spacing, 4);
  assert.equal(r.score, 7.5);
});

test("the line that scored each category is kept, for printing", () => {
  const r = parseScorecard(`1. Typography: 6/10 - small labels\n${card([8, 8, 8, 8, 8, 8, 8, 8]).split("\n").slice(1).join("\n")}`);
  assert.equal(r.lines.Typography, "1. Typography: 6/10 - small labels");
});

test("nothing after the first FIX line scores, bullets without the prefix included", () => {
  const r = parseScorecard(`${card([8, 8, 4, 8, 8, 8, 8, 8])}\nFIX: one spacing scale\n- Spacing: 9/10 reachable with one scale`);
  assert.equal(r.categories.Spacing, 4);
});

test("every common way of writing a FIX line ends the scores", () => {
  for (const fix of ["FIX: one scale", "**FIX**: one scale", "1. FIX: one scale", "### FIX: one scale", "> FIX: one scale", "FIX : one scale", "- FIX: one scale"]) {
    const r = parseScorecard(`${card([8, 8, 4, 8, 8, 8, 8, 8])}\n${fix}\nSpacing: 9/10 - after the fixes`);
    assert.equal(r.categories.Spacing, 4, fix);
  }
});

test("a category spelled with & still scores", () => {
  const r = parseScorecard(card([8, 8, 8, 6, 8, 8, 8, 8]).replace("Color and contrast", "Color & contrast"));
  assert.equal(r.categories["Color and contrast"], 6);
});

test("--min takes a score from 0 to 10 and nothing else", () => {
  assert.equal(parseMin("8"), 8);
  assert.equal(parseMin("7.5"), 7.5);
  assert.equal(parseMin("0"), 0);
  for (const bad of ["abc", "", " ", "8x", "-1", "11", "NaN", "Infinity"]) assert.equal(parseMin(bad), null, JSON.stringify(bad));
});

test("npm run ui-score with a bad --min exits 2 before taking a screenshot", () => {
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "../../scripts/ui-score.mjs"), "chat", "--min", "abc"], { encoding: "utf8", timeout: 20_000 });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--min takes a score from 0 to 10/);
  assert.equal(r.stdout, "");
});
