import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AA, pairs, ratio, themeTokens } from "./contrast.ts";

test("ratio matches WCAG's own examples", () => {
  assert.equal(ratio("#000", "#fff").toFixed(1), "21.0");
  assert.equal(ratio("#767676", "#fff").toFixed(2), "4.54");
});

test("every text token meets AA on every surface, in both themes", () => {
  const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
  const low = pairs(css).filter((p) => p.ratio < AA);
  assert.deepEqual(
    low.map((p) => `${p.theme} --${p.fg} on --${p.bg}: ${p.ratio.toFixed(2)}`),
    [],
  );
});

test("themeTokens reads the exact block, not a longer selector that starts the same", () => {
  const css = ':root[data-theme="light"][data-contrast="high"] { --text: #000000; }\n:root[data-theme="light"] { --text: #222222; }';
  assert.deepEqual(themeTokens(css, ':root[data-theme="light"]'), { text: "#222222" });
});
