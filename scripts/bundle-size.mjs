// Bundle size table for PRs. `measure <dist> <out.json>` records each built file's raw and gzip size;
// `compare <base.json> <head.json>` prints the PR comment (src/lib/bundleSize.ts).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { assetName, compareSizes, sizeTable } from "../src/lib/bundleSize.ts";

const [cmd, a, b] = process.argv.slice(2);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
}

if (cmd === "measure") {
  const sizes = {};
  for (const file of walk(a).filter((f) => /\.(js|css|html)$/.test(f))) {
    const buf = readFileSync(file);
    const key = assetName(relative(a, file));
    const prev = sizes[key] ?? { raw: 0, gzip: 0 };
    sizes[key] = { raw: prev.raw + buf.length, gzip: prev.gzip + gzipSync(buf).length };
  }
  writeFileSync(b, JSON.stringify(sizes, null, 1));
} else if (cmd === "compare") {
  const read = (p) => JSON.parse(readFileSync(p, "utf8"));
  console.log(sizeTable(compareSizes(read(a), read(b))));
} else {
  console.error("usage: bundle-size.mjs measure <dist> <out.json> | compare <base.json> <head.json>");
  process.exit(2);
}
