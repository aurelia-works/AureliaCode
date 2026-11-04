// `npm run contrast`: prints every text/surface pair in src/styles/tokens.css with its WCAG ratio.
// Exits 1 when a pair is below AA. The maths lives in src/lib/contrast.ts (kept free of Node APIs).
import { readFileSync } from "node:fs";
import { AA, pairs } from "../src/lib/contrast.ts";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
let low = 0;
for (const p of pairs(css)) {
  const ok = p.ratio >= AA;
  if (!ok) low++;
  console.log(`${ok ? "ok  " : "LOW "} ${p.theme.padEnd(5)} --${p.fg.padEnd(10)} on --${p.bg.padEnd(9)} ${p.ratio.toFixed(2)}:1`);
}
console.log(low ? `${low} pair(s) below ${AA}:1` : `all pairs meet ${AA}:1`);
process.exitCode = low ? 1 : 0;
