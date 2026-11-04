import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, parseScorecard, scorePrompt } from "./uiScore.ts";

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
