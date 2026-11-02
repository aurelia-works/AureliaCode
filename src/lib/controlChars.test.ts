import assert from "node:assert/strict";
import { test } from "node:test";
import { dropStray } from "./controlChars.ts";

test("the right arrow arriving as text leaves no box behind", () => {
  assert.deepEqual(dropStray("hello\x1d\x1d", 7), { value: "hello", caret: 5 });
});

test("right and left arrows arriving as text still move the caret", () => {
  assert.deepEqual(dropStray("ab\x1dcd", 3), { value: "abcd", caret: 3 });
  assert.deepEqual(dropStray("ab\x1ccd", 3), { value: "abcd", caret: 1 });
});

test("newlines, tabs and ordinary text are left alone", () => {
  assert.deepEqual(dropStray("a\n\tb é ☃", 3), { value: "a\n\tb é ☃", caret: 3 });
});

test("other control characters go too", () => {
  assert.deepEqual(dropStray("a\x1bb\x7f", 4), { value: "ab", caret: 2 });
});
