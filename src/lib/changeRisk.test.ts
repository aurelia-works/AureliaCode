import assert from "node:assert/strict";
import { test } from "node:test";
import { changeRisk } from "./changeRisk.ts";

test("a small change to ordinary files is low risk", () => {
  assert.deepEqual(changeRisk(["src/components/Button.tsx", "src/lib/format.ts"], 40, 10), { level: "low", why: [] });
});

test("tests-only changes are low risk however big", () => {
  assert.equal(changeRisk(["src/lib/a.test.ts", "tests/big_test.rs"], 900, 0).level, "low");
});

test("auth, billing, CI and secrets are high risk", () => {
  assert.equal(changeRisk(["src/auth/session.ts"], 3, 1).level, "high");
  assert.equal(changeRisk(["app/billing/invoice.ts"], 3, 1).level, "high");
  assert.equal(changeRisk([".github/workflows/ci.yml"], 1, 1).level, "high");
  assert.equal(changeRisk([".env.local"], 1, 0).level, "high");
  assert.ok(changeRisk([".github/workflows/ci.yml"], 1, 1).why.includes("changes CI"));
});

test("dependencies, size and spread make it medium; very large makes it high", () => {
  assert.equal(changeRisk(["package.json", "src/a.ts"], 2, 1).level, "medium");
  assert.equal(changeRisk(["src/a.ts"], 300, 50).level, "medium");
  assert.equal(changeRisk(Array.from({ length: 25 }, (_, i) => `src/f${i}.ts`), 50, 0).level, "medium");
  const big = changeRisk(["src/a.ts"], 1500, 200);
  assert.equal(big.level, "high");
  assert.ok(big.why[0].includes("1700 lines"));
});
