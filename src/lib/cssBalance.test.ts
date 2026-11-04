import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A merge that drops a closing brace swallows every rule after it, and Vite builds it anyway.
test("every stylesheet closes each block it opens", () => {
  const dir = join(import.meta.dirname, "../styles");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".css"))) {
    const css = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/"[^"\n]*"|'[^'\n]*'/g, "");
    let depth = 0;
    css.split("\n").forEach((line, i) => {
      for (const c of line) {
        depth += c === "{" ? 1 : c === "}" ? -1 : 0;
        assert.ok(depth >= 0, `${f}:${i + 1} closes a block that isn't open`);
      }
    });
    assert.equal(depth, 0, `${f} leaves ${depth} block(s) open`);
  }
});
