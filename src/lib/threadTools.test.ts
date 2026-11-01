import assert from "node:assert/strict";
import { test } from "node:test";
import { followUpAction, paletteQuery, prNumberRef, retitle } from "./threadTools.ts";

test("idle sends; busy follows the mode; the opposite key flips it once", () => {
  assert.equal(followUpAction(false, "steer", false), "send");
  assert.equal(followUpAction(false, "queue", true), "send");
  assert.equal(followUpAction(true, "queue", false), "queue");
  assert.equal(followUpAction(true, "queue", true), "steer");
  assert.equal(followUpAction(true, "steer", false), "steer");
  assert.equal(followUpAction(true, "steer", true), "queue");
});

test("a leading > filters the palette to actions", () => {
  assert.deepEqual(paletteQuery(">settings"), { actionsOnly: true, text: "settings" });
  assert.deepEqual(paletteQuery("  > roadmap "), { actionsOnly: true, text: "roadmap" });
  assert.deepEqual(paletteQuery(">"), { actionsOnly: true, text: "" });
  assert.deepEqual(paletteQuery("web "), { actionsOnly: false, text: "web" });
});

test("PR number reference", () => {
  assert.equal(prNumberRef(212), "#212");
});

test("retitle takes the latest substantive user message, first useful line", () => {
  const items = [
    { kind: "user", text: "Add idempotency keys to the refund endpoint" },
    { kind: "assistant", text: "Done." },
    { kind: "user", text: "ok" },
    { kind: "user", text: "/clear" },
    { kind: "user", text: "```\n\n```\n- Fix the flaky settings test on CI" },
  ];
  assert.equal(retitle(items), "Fix the flaky settings test on CI");
  assert.equal(retitle(items.slice(0, 4)), "Add idempotency keys to the refund endpoint");
});

test("retitle cuts long lines at a word and returns undefined when nothing fits", () => {
  const long = "Rewrite the quickstart so every example uses the new profile flag and mentions multiple accounts";
  const t = retitle([{ kind: "user", text: long }])!;
  assert.ok(t.length <= 61 && t.endsWith("…") && !t.includes("accounts"));
  assert.equal(retitle([{ kind: "user", text: "hi" }, { kind: "assistant", text: "Hello there friend" }]), undefined);
  assert.equal(retitle([]), undefined);
});
