import assert from "node:assert/strict";
import test from "node:test";
import { frameHeight, isVisualTool, parseVisual, visualSrcdoc } from "./visualReply.ts";

test("the show_html tool is known under every provider's naming", () => {
  assert.equal(isVisualTool("mcp__aurelia__aurelia_show_html"), true);
  assert.equal(isVisualTool("aurelia.aurelia_show_html"), true);
  assert.equal(isVisualTool("aurelia_show_html"), true);
  assert.equal(isVisualTool("mcp__aurelia__aurelia_open_pane"), false);
  assert.equal(isVisualTool("Bash"), false);
});

test("a visual reply reads its title, page and served url", () => {
  const url = "http://127.0.0.1:51234/0123456789abcdef/fedcba9876543210.html";
  const v = parseVisual({ title: " Bundle sizes ", html: "<p>hi</p>" }, JSON.stringify({ url, shown: "chat" }));
  assert.deepEqual(v, { title: "Bundle sizes", html: "<p>hi</p>", url });
});

test("no page, no card; a missing title or url is fine", () => {
  assert.equal(parseVisual({ title: "x" }, undefined), null);
  assert.equal(parseVisual({ html: "  " }, undefined), null);
  assert.deepEqual(parseVisual({ html: "<b>a</b>" }, "html is over 2 MB"), { title: "Visual reply", html: "<b>a</b>", url: undefined });
});

test("only a loopback renders url counts as the page's url", () => {
  assert.equal(parseVisual({ html: "<b>a</b>" }, '{"url":"https://evil.example/x.html"}')?.url, undefined);
});

test("the theme and the bridge go before the page's own head, so its styles win", () => {
  const doc = visualSrcdoc('<!doctype html><html><head><style>body{color:red}</style></head><body>x</body></html>', { "--bg": "#000", "--text": "#fff" }, "dark");
  const theme = doc.indexOf("--bg: #000");
  assert.ok(theme > 0, "theme vars are injected");
  assert.ok(theme < doc.indexOf("color:red"), "page styles come after the theme");
  assert.ok(doc.startsWith("<!doctype html>"), "the doctype stays first");
  assert.match(doc, /color-scheme: dark/);
  assert.match(doc, /postMessage/);
});

test("a bare fragment gets a document around it", () => {
  const doc = visualSrcdoc("<h1>Hi</h1>", {}, "light");
  assert.match(doc, /^<!doctype html><html><head>/);
  assert.match(doc, /<body><h1>Hi<\/h1><\/body><\/html>$/);
  assert.match(doc, /color-scheme: light/);
});

test("a <header> or <html-like> tag is not mistaken for <head> or <html>", () => {
  const doc = visualSrcdoc('<header class="hero">Hi</header>', {}, "light");
  assert.match(doc, /^<!doctype html><html><head>/);
  assert.match(doc, /<body><header class="hero">Hi<\/header><\/body><\/html>$/);
  assert.match(visualSrcdoc("<html-card>x</html-card>", {}, "light"), /<body><html-card>x<\/html-card><\/body>/);
});

test("a theme value can't close the style tag", () => {
  const doc = visualSrcdoc("x", { "--bg": "red</style><script>alert(1)</script>" }, "dark");
  assert.doesNotMatch(doc, /red<\/style>/);
});

test("the card's height follows the page within bounds", () => {
  assert.equal(frameHeight(40), 120);
  assert.equal(frameHeight(300.4), 301);
  assert.equal(frameHeight(5000), 520);
  assert.equal(frameHeight(Number.NaN), 120);
});
