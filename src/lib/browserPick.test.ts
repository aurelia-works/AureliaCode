import assert from "node:assert/strict";
import test from "node:test";
import { parsePickUrl, pickPrompt, sanitizePick, selectorFor } from "./browserPick.ts";

test("ids win over the path", () => {
  assert.equal(selectorFor("button", "save", "main > button"), "#save");
  assert.equal(selectorFor("button", "", "main > button:nth-of-type(2)"), "main > button:nth-of-type(2)");
});

test("a page payload is trimmed and normalized", () => {
  const p = sanitizePick({ selector: " #save ", tag: "BUTTON", text: "  Save\n  changes ", html: "<button>Save</button>", url: "http://x", rect: { x: 1.4, y: 2, w: 3, h: 4 } });
  assert.deepEqual(p, { selector: "#save", tag: "button", text: "Save changes", html: "<button>Save</button>", url: "http://x", rect: { x: 1, y: 2, w: 3, h: 4 } });
  assert.equal(sanitizePick({ selector: "", tag: "button" }), null);
  assert.equal(sanitizePick(null), null);
});

test("the custom navigation payload round-trips", () => {
  const p = { selector: "#save", tag: "button", text: "Save", url: "http://x", rect: { x: 1, y: 2, w: 3, h: 4 } };
  assert.deepEqual(parsePickUrl(`aurelia-pick:${encodeURIComponent(JSON.stringify(p))}`), p);
  assert.equal(parsePickUrl("https://example.com"), null);
  assert.equal(parsePickUrl("aurelia-pick:%E0%A4%A"), null);
  assert.equal(parsePickUrl("aurelia-pick:%7B%7D"), null);
});

test("the composer message names the element and its evidence", () => {
  const p = sanitizePick({ selector: "#save", tag: "button", text: "Save", html: "<button>Save</button>", shot: "/tmp/shot.png" })!;
  const text = pickPrompt(p);
  assert.match(text, /Browser element: #save \(<button>\)/);
  assert.match(text, /Text: “Save”/);
  assert.match(text, /Screenshot: \/tmp\/shot.png/);
});
