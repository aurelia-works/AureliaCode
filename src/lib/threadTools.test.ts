import assert from "node:assert/strict";
import { test } from "node:test";
import { composerEnter, followUpAction, locationTitle, paletteQuery, prNumberRef, retitle, startWorktree } from "./threadTools.ts";

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

test("the location title uses the thread's own name before New thread", () => {
  assert.equal(locationTitle({ fresh: true, taskTitle: "Keyboard-accessible settings nav" }), "Keyboard-accessible settings nav");
  assert.equal(locationTitle({ paneTitle: "Refunds", chatTitle: "add keys", taskTitle: "other" }), "Refunds");
  assert.equal(locationTitle({ chatTitle: "add keys", taskTitle: "other" }), "add keys");
  assert.equal(locationTitle({ fresh: true, launcher: true }), "New thread");
  assert.equal(locationTitle({ namedAgent: true }), "Claude");
  assert.equal(locationTitle({ editorName: "Nav.tsx" }), "Nav.tsx");
  assert.equal(locationTitle({}), "Terminal");
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

test("Send with Enter: Enter sends, ⌘Enter flips Queue/Steer, ⇧Enter is a newline", () => {
  assert.equal(composerEnter({ meta: false, shift: false }, true), "send");
  assert.equal(composerEnter({ meta: true, shift: false }, true), "opposite");
  assert.equal(composerEnter({ meta: false, shift: true }, true), "newline");
});

test("Send with ⌘Enter: ⌘Enter is the plain send, not the Queue/Steer flip", () => {
  assert.equal(composerEnter({ meta: false, shift: false }, false), "newline");
  assert.equal(composerEnter({ meta: false, shift: true }, false), "newline");
  assert.equal(composerEnter({ meta: true, shift: false }, false), "send");
  assert.equal(composerEnter({ meta: true, shift: true }, false), "opposite");
});

test("worktree by default wins over the saved switch at launch; off keeps the saved switch", () => {
  assert.equal(startWorktree(false, true), true);
  assert.equal(startWorktree(undefined, true), true);
  assert.equal(startWorktree(true, false), true);
  assert.equal(startWorktree(false, false), false);
  assert.equal(startWorktree(undefined, undefined), false);
});
