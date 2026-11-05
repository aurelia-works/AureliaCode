import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { readSaved } from "./savedState.ts";

test("a read error is not 'no file': it comes back as not ok, with the reason", async () => {
  assert.deepEqual(await readSaved(() => Promise.reject(new Error("tasks.json: Permission denied"))), { ok: false, error: "tasks.json: Permission denied" });
  assert.deepEqual(await readSaved(() => Promise.reject("EIO")), { ok: false, error: "EIO" });
  assert.deepEqual(await readSaved(() => Promise.resolve(null)), { ok: true, value: null });
  assert.deepEqual(await readSaved(() => Promise.resolve({ a: 1 })), { ok: true, value: { a: 1 } });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });
}

test("no store swallows a state-file read error (it would later save an empty state over the real file)", () => {
  const offenders = sources("src").filter((f) => /ipc\.loadState(<[^(]*>)?\([^)]*\)\s*\.catch\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, [], "use readSaved() and don't save when it isn't ok");
});
