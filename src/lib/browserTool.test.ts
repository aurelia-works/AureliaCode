import { test } from "node:test";
import assert from "node:assert/strict";
import { browserTool, parseBrowserAction } from "./browserTool.ts";

test("only the browser tool becomes a browser card", () => {
  assert.equal(browserTool("mcp__aurelia__aurelia_browser"), "browser");
  assert.equal(browserTool("aurelia_browser"), "browser");
  assert.equal(browserTool("mcp__aurelia__aurelia_delegate"), null);
});

test("an open says which page it got", () => {
  const b = parseBrowserAction("mcp__aurelia__aurelia_browser", { action: "open", url: "http://localhost:1437/" }, '{"pane":"p9","url":"http://localhost:1437/","title":"AureliaCode"}');
  assert.equal(b?.summary, "Opened AureliaCode");
  assert.equal(b?.pane, "p9");
  assert.equal(b?.ok, true);
});

test("a snapshot keeps the text tree and counts it", () => {
  const text = "url: http://x/\ntitle: X\nviewport: 800x600, scrolled 0/1200\n\n- main\n  - button \"Save\" [ref=e1]";
  const b = parseBrowserAction("aurelia_browser", { action: "snapshot" }, JSON.stringify({ text }));
  assert.equal(b?.text, text);
  assert.match(b?.summary ?? "", /Snapshot · 6 lines/);
});

test("an action names its target and keeps the page's warning", () => {
  const b = parseBrowserAction("aurelia_browser", { action: "act", kind: "click", ref: "e12" }, JSON.stringify({ ok: true, kind: "click", target: "button#save [ref=e12]", note: "covered by div.toast at its centre; dispatched to the element anyway" }));
  assert.equal(b?.summary, "Clicked button#save [ref=e12]");
  assert.match(b?.note ?? "", /covered by/);
});

test("a screenshot card carries its image path and size", () => {
  const b = parseBrowserAction("aurelia_browser", { action: "screenshot", ref: "e3" }, JSON.stringify({ image: "/tmp/snap.png", width: 800, height: 600, url: "http://x/" }) + "\n[image]");
  assert.equal(b?.summary, "Screenshot 800×600");
  assert.equal(b?.image, "/tmp/snap.png");
  assert.equal(b?.ok, true);
});

test("a failed action shows the reason instead of a summary", () => {
  const b = parseBrowserAction("aurelia_browser", { action: "act", ref: "e9" }, "ref e9 is gone (the page changed or navigated); take a new snapshot", true);
  assert.equal(b?.ok, false);
  assert.match(b?.summary ?? "", /ref e9 is gone/);
});

test("a wait that times out says so while keeping the call's result", () => {
  const b = parseBrowserAction("aurelia_browser", { action: "wait", text: "Done" }, JSON.stringify({ ok: false, waitedMs: 5000, reason: "timed out" }));
  assert.equal(b?.ok, true, "the call itself completed");
  assert.match(b?.summary ?? "", /timed out/);
});

test("a real snapshot arrives as plain text (the MCP sends the tree alone), and still folds", () => {
  const text = "url: http://x/\ntitle: X\n\n- button \"Save\" [ref=e1]";
  const b = parseBrowserAction("mcp__aurelia__aurelia_browser", { action: "snapshot" }, text);
  assert.equal(b?.text, text);
  assert.equal(b?.raw, undefined);
  assert.match(b?.summary ?? "", /Snapshot · 4 lines/);
  assert.equal(b?.ok, true);
});
