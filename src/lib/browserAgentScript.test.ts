import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The script WebKit runs for aurelia_browser (src-tauri/src/browser_agent.rs). It is an async
// function body taking `a`; page globals are passed in so it runs here without a DOM.
const body = readFileSync(new URL("../../src-tauri/src/browser_agent.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const run = new AsyncFunction("a", "document", "location", "globalThis", body);

const page = (text: string) => ({
  document: { readyState: "complete", title: "Chat", body: { innerText: text } },
  location: { href: "http://localhost:1441/design/preview/?view=chat" },
});

async function call(req: object, text = "") {
  const { document, location } = page(text);
  return JSON.parse(await run(JSON.stringify(req), document, location, {}));
}

test("unknown actions come back as an error, not a throw", async () => {
  assert.deepEqual(await call({ action: "drive" }), { error: "unknown action drive" });
});

test("wait for text resolves when the text is there, and times out when it isn't", async () => {
  const hit = await call({ action: "wait", text: "Worked for", timeoutMs: 1000 }, "Worked for 3s");
  assert.equal(hit.ok, true);
  assert.equal(hit.title, "Chat");
  const miss = await call({ action: "wait", text: "never", timeoutMs: 150 }, "nothing here");
  assert.equal(miss.ok, false);
  assert.equal(miss.reason, "timed out");
  const gone = await call({ action: "wait", text: "Loading", gone: true, timeoutMs: 150 }, "ready");
  assert.equal(gone.ok, true);
});

test("a stale ref says to snapshot again", async () => {
  const r = await call({ action: "inspect", ref: "e99" });
  assert.match(r.error, /ref e99 is gone.*new snapshot/);
});
