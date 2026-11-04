// WCAG contrast over src/styles/tokens.css: every text token on every surface it sits on, both themes.
// `npm run contrast` (scripts/contrast.mjs) prints the table; contrast.test.ts fails on a pair below AA.

/** Text tokens and the backgrounds they are drawn on. 4.5:1 is AA for body text. */
export const TEXT = ["text", "text-dim", "text-faint", "ok", "err", "warn", "attn", "work"];
export const SURFACES = ["bg", "surface", "surface-2"];
/** Filled controls: ink on its fill. */
export const FILLS: [string, string][] = [["accent-ink", "accent"]];
export const AA = 4.5;

/** The hex colours a theme block in tokens.css sets, by token name without the dashes. */
export function themeTokens(css: string, selector: string): Record<string, string> {
  // The exact block, not one whose selector only starts the same (`…[data-theme="light"][data-contrast="high"]`).
  const start = css.search(new RegExp(selector.replace(/[[\]"().*+?^$|\\]/g, "\\$&") + "\\s*\\{"));
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function ratio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export type Pair = { theme: string; fg: string; bg: string; ratio: number };

/** Every pair the app draws, with its ratio. */
export function pairs(css: string): Pair[] {
  const out: Pair[] = [];
  for (const [theme, selector] of [
    ["dark", ':root[data-theme="dark"]'],
    ["light", ':root[data-theme="light"]'],
  ]) {
    const t = themeTokens(css, selector);
    const all: [string, string][] = [...TEXT.flatMap((fg) => SURFACES.map((bg): [string, string] => [fg, bg])), ...FILLS];
    for (const [fg, bg] of all) {
      if (!t[fg] || !t[bg]) throw new Error(`${theme}: --${fg} or --${bg} is not a hex colour`);
      out.push({ theme, fg, bg, ratio: ratio(t[fg], t[bg]) });
    }
  }
  return out;
}
