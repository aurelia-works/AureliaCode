import assert from "node:assert/strict";
import { test } from "node:test";
import { selectAllAction } from "./selectAll.ts";

test("⌘A in a chat pane selects the message list, not an xterm that isn't there", () => {
  assert.equal(selectAllAction({ mode: "chat" }, false), "chat");
});

test("⌘A in a text field is left to the field", () => {
  assert.equal(selectAllAction({ mode: "chat" }, true), "native");
  assert.equal(selectAllAction({}, true), "native");
});

test("⌘A in a chat's empty box selects the conversation; a box with text keeps it", () => {
  assert.equal(selectAllAction({ mode: "chat" }, true, true), "chat");
  assert.equal(selectAllAction({ mode: "chat" }, true, false), "native");
  assert.equal(selectAllAction({}, true, true), "native");
});

test("⌘A in a terminal pane selects the terminal; browser, editor and start panes keep the native behaviour", () => {
  assert.equal(selectAllAction({}, false), "terminal");
  assert.equal(selectAllAction({ browser: { url: "" } }, false), "native");
  assert.equal(selectAllAction({ editor: { path: "/a" } }, false), "native");
  assert.equal(selectAllAction({ launcher: true }, false), "native");
  assert.equal(selectAllAction(undefined, false), "native");
});
