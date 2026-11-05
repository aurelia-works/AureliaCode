import assert from "node:assert/strict";
import { test } from "node:test";
import { assetName, compareSizes, sizeTable, MARKER } from "./bundleSize.ts";

test("hashed build names match across builds", () => {
  assert.equal(assetName("assets/index-B3xk9_aQ.js"), "assets/index.js");
  assert.equal(assetName("assets/vendor-react-Dk2-1aQz.css"), "assets/vendor-react.css");
  assert.equal(assetName("index.html"), "index.html");
  assert.equal(assetName("assets/use-standard.js"), "assets/use-standard.js", "an all-lowercase word is not a hash");
});

test("compare lines up files by name and totals JS and CSS", () => {
  const base = { "assets/index.js": { raw: 1000, gzip: 400 }, "assets/old.js": { raw: 50, gzip: 20 }, "assets/index.css": { raw: 300, gzip: 100 } };
  const head = { "assets/index.js": { raw: 1200, gzip: 450 }, "assets/new.js": { raw: 80, gzip: 30 }, "assets/index.css": { raw: 300, gzip: 100 } };
  const c = compareSizes(base, head);
  const row = (f: string) => c.rows.find((r) => r.file === f);
  assert.deepEqual(row("assets/index.js"), { file: "assets/index.js", base: 400, head: 450 });
  assert.deepEqual(row("assets/old.js"), { file: "assets/old.js", base: 20, head: 0 });
  assert.deepEqual(row("assets/new.js"), { file: "assets/new.js", base: 0, head: 30 });
  assert.equal(row("assets/index.css"), undefined, "unchanged files are left out");
  assert.deepEqual(c.js, { base: 420, head: 480 });
  assert.deepEqual(c.css, { base: 100, head: 100 });
});

test("the table leads with the marker so CI can find and edit its own comment", () => {
  const c = compareSizes({ "a.js": { raw: 2048, gzip: 1024 } }, { "a.js": { raw: 4096, gzip: 1536 } });
  const md = sizeTable(c);
  assert.ok(md.startsWith(MARKER));
  assert.match(md, /\| JS total \| 1\.0 kB \| 1\.5 kB \| \+512 B \(\+50\.0%\) \|/);
  assert.match(md, /\| `a\.js` \|/);
});

test("no change says so instead of an empty table", () => {
  const same = { "a.js": { raw: 10, gzip: 5 } };
  assert.match(sizeTable(compareSizes(same, same)), /No file changed size/);
});

test("rows are capped and the biggest changes come first", () => {
  const base: Record<string, { raw: number; gzip: number }> = {};
  const head: Record<string, { raw: number; gzip: number }> = {};
  for (let i = 0; i < 30; i++) { base[`f${i}.js`] = { raw: 100, gzip: 100 }; head[`f${i}.js`] = { raw: 100, gzip: 101 + i }; }
  const c = compareSizes(base, head);
  assert.equal(c.rows.length, 30);
  const md = sizeTable(c, 5);
  assert.equal((md.match(/\| `f/g) ?? []).length, 5);
  assert.ok(md.indexOf("`f29.js`") < md.indexOf("`f28.js`"));
  assert.match(md, /25 more files changed/);
});
