import assert from "node:assert/strict";
import { test } from "node:test";
import { familyOf } from "./threadFamily.ts";

const panes = {
  lead: { id: "lead" },
  a: { id: "a", openedBy: "lead" },
  b: { id: "b", openedBy: "lead" },
  c: { id: "c", openedBy: "a" },
  orphan: { id: "orphan", openedBy: "gone" },
};

test("a parent knows its children, and a child its parent", () => {
  assert.deepEqual(familyOf(panes, "lead"), { parent: undefined, children: ["a", "b"] });
  assert.deepEqual(familyOf(panes, "a"), { parent: "lead", children: ["c"] });
});

test("a closed parent isn't linked", () => {
  assert.deepEqual(familyOf(panes, "orphan"), { parent: undefined, children: [] });
});

test("a pane that names itself is not its own parent", () => {
  assert.deepEqual(familyOf({ x: { id: "x", openedBy: "x" } }, "x"), { parent: undefined, children: [] });
});
