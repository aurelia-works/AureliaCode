import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SKILL_ROOTS, filterSkills, parseFrontmatter, parseSkill, savedRoots, skillPrompt, sortSkills } from "./skills.ts";

const swarm = `---
name: ds-swarm
description: "Fan out N parallel workers on slices of a job."
---

# ds-swarm

Split work across workers.
`;

const other = `---
name: ds-tdd
description: Red, green, refactor.
---
# ds-tdd

Write a failing test first.
`;

test("frontmatter keeps quoted descriptions and the body", () => {
  const { data, body } = parseFrontmatter(swarm);
  assert.equal(data.name, "ds-swarm");
  assert.equal(data.description, "Fan out N parallel workers on slices of a job.");
  assert.match(body, /Split work across workers/);
});

test("a skill falls back to its folder name when frontmatter is missing", () => {
  const s = parseSkill("# no frontmatter\n\nDo the thing.", "/tmp/skills/plain", "/tmp/skills");
  assert.equal(s?.name, "plain");
  assert.equal(s?.description, "Do the thing.");
  assert.equal(s?.deepseek, false);
});

test("ds-swarm sorts before the rest of the DeepSeek pack", () => {
  const a = parseSkill(swarm, "/r/.agents/skills/ds-swarm", "/r/.agents/skills")!;
  const b = parseSkill(other, "/r/.agents/skills/ds-tdd", "/r/.agents/skills")!;
  const c = parseSkill(`---\nname: zed\ndescription: z\n---\n`, "/r/.agents/skills/zed", "/r/.agents/skills")!;
  assert.deepEqual(sortSkills([c, b, a]).map((s) => s.name), ["ds-swarm", "ds-tdd", "zed"]);
  assert.equal(a.deepseek, true);
});

test("filter matches name, description or body", () => {
  const a = parseSkill(swarm, "/r/.agents/skills/ds-swarm", "/r/.agents/skills")!;
  const b = parseSkill(other, "/r/.agents/skills/ds-tdd", "/r/.agents/skills")!;
  assert.equal(filterSkills([a, b], "parallel")[0].name, "ds-swarm");
  assert.equal(filterSkills([a, b], "failing")[0].name, "ds-tdd");
  assert.equal(filterSkills([a, b], "").length, 2);
});

test("the prompt carries the procedure and the task", () => {
  const s = parseSkill(swarm, "/r/.agents/skills/ds-swarm", "/r/.agents/skills")!;
  const p = skillPrompt(s, "Audit the auth module");
  assert.match(p, /Use the ds-swarm skill/);
  assert.match(p, /Split work across workers/);
  assert.match(p, /Audit the auth module/);
  assert.match(p, /PASS, ISSUES or BLOCKED/);
});

test("an empty saved root list is your choice and survives a restart; a missing or broken one gets the defaults", () => {
  assert.deepEqual(savedRoots({ roots: [] }), []);
  const mine = [{ path: "~/my-skills", label: "Mine" }];
  assert.deepEqual(savedRoots({ roots: mine }), mine);
  assert.equal(savedRoots(null), DEFAULT_SKILL_ROOTS);
  assert.equal(savedRoots({}), DEFAULT_SKILL_ROOTS);
  assert.equal(savedRoots({ roots: "nope" }), DEFAULT_SKILL_ROOTS);
  assert.deepEqual(savedRoots({ roots: [{ path: "~/ok", label: "Ok" }, { path: 3 }, null] }), [{ path: "~/ok", label: "Ok" }]);
});
