import assert from "node:assert/strict";
import { test } from "node:test";
import { expandSkillRefs, skillQuery } from "./skillRefs.ts";

const names = ["unslop", "code-review", "ship"];

test("a leading $skill runs as Claude Code's /skill", () => {
  assert.equal(expandSkillRefs("$unslop the board view", names), "/unslop the board view");
  assert.equal(expandSkillRefs("$ship", names), "/ship");
});

test("an inline $skill asks Claude to use that skill by name", () => {
  assert.equal(expandSkillRefs("tidy this, then $code-review it", names), 'tidy this, then the "code-review" skill it');
});

test("unknown names, prices and shell variables are left alone", () => {
  assert.equal(expandSkillRefs("costs $5 and $HOME is set", names), "costs $5 and $HOME is set");
  assert.equal(expandSkillRefs("echo a$ship", names), "echo a$ship");
});

test("the $ menu opens on a $word at the caret", () => {
  assert.equal(skillQuery("run $uns"), "uns");
  assert.equal(skillQuery("$"), "");
  assert.equal(skillQuery("costs 5$"), undefined);
  assert.equal(skillQuery("run $uns now"), undefined);
});
