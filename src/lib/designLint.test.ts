/**
 * The design system, enforced: UI review kept finding too many type sizes, too many button
 * styles and unlabelled icon buttons, because nothing stopped new code adding more. These checks do.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const files = (dir: string, ext: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name), ext) : e.name.endsWith(ext) ? [join(dir, e.name)] : [],
  );
const lineOf = (s: string, at: number) => s.slice(0, at).split("\n").length;

/** Each `<button ...>` opening tag with its offset; a ">" inside {...} (an arrow handler) doesn't end it. */
function buttonTags(s: string): { at: number; tag: string }[] {
  const out: { at: number; tag: string }[] = [];
  for (const m of s.matchAll(/<button\b/g)) {
    let depth = 0;
    let end = m.index! + 7;
    for (; end < s.length; end++) {
      const c = s[end];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ at: m.index!, tag: s.slice(m.index!, end) });
  }
  return out;
}

test("font sizes come from the type scale (--fs-*), never a raw px value", () => {
  const bad: string[] = [];
  for (const f of files("styles", ".css")) {
    if (f.endsWith("tokens.css")) continue;
    const s = readFileSync(join(root, f), "utf8");
    for (const m of s.matchAll(/font(?:-size)?:\s*(?:\d{3}\s+)?\d+(?:\.\d+)?px/g)) bad.push(`${f}:${lineOf(s, m.index!)} ${m[0]}`);
  }
  assert.deepEqual(bad, [], `Use var(--fs-label|meta|body|title|page|hero):\n${bad.join("\n")}`);
});

/** Every button family the app has. A new one is a new button style: use .btn (primary/sm), .link-btn or an icon button instead. */
const BUTTON_FAMILIES = new Set(["btn", "icon-btn", "link-btn", "today-btn", "notice-btn", "mini-btn", "chat-pick-btn"]);

test("buttons use the existing button families only", () => {
  const bad: string[] = [];
  for (const f of files("components", ".tsx")) {
    const s = readFileSync(join(root, f), "utf8");
    for (const { at, tag } of buttonTags(s)) {
      const cls = /className=\{?[`"]([^`"]*)/.exec(tag)?.[1] ?? "";
      for (const c of cls.split(/\s+/)) if (/^[a-z-]*-btn$/.test(c) && !BUTTON_FAMILIES.has(c)) bad.push(`${f}:${lineOf(s, at)} ${c}`);
    }
  }
  assert.deepEqual(bad, [], `New button family; reuse one of ${[...BUTTON_FAMILIES].join(", ")}:\n${bad.join("\n")}`);
});

test("an icon-only button says what it does (title or aria-label)", () => {
  const bad: string[] = [];
  for (const f of files("components", ".tsx")) {
    const s = readFileSync(join(root, f), "utf8");
    for (const { at, tag } of buttonTags(s)) {
      const iconOnly = /className=\{?[`"][^`"]*\b(icon-btn|ib)\b/.test(tag) && !/\blabelled\b/.test(tag);
      if (iconOnly && !/\b(title|aria-label)=/.test(tag)) bad.push(`${f}:${lineOf(s, at)}`);
    }
  }
  assert.deepEqual(bad, [], `Icon-only button without title or aria-label:\n${bad.join("\n")}`);
});
