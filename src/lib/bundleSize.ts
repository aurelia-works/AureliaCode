/** Bundle size table for PRs (Theo, 2026-11-04 01:31: "It puts feedback in the PR that a babysitting agent will notice").
 *  CI measures the web build of the base and the PR; this compares them and renders the PR comment. Sizes are gzip bytes. */

export const MARKER = "<!-- bundle-size -->";

export interface Size { raw: number; gzip: number }
export type Sizes = Record<string, Size>;
export interface Row { file: string; base: number; head: number }
export interface Total { base: number; head: number }
export interface Comparison { rows: Row[]; js: Total; css: Total }

/** Vite names files `name-<hash>.ext` (8 base64url characters); drop the hash so the same file lines up across builds.
 *  A hash has a capital, digit or underscore, so a plain word like `use-standard.js` is left alone. */
export function assetName(path: string): string {
  return path.replace(/-(?=[a-z-]*[A-Z0-9_])[A-Za-z0-9_-]{8}(\.[a-z0-9]+)$/, "$1");
}

export function compareSizes(base: Sizes, head: Sizes): Comparison {
  const files = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
  const rows: Row[] = [];
  const js = { base: 0, head: 0 };
  const css = { base: 0, head: 0 };
  for (const file of files) {
    const b = base[file]?.gzip ?? 0;
    const h = head[file]?.gzip ?? 0;
    const total = file.endsWith(".js") ? js : file.endsWith(".css") ? css : null;
    if (total) { total.base += b; total.head += h; }
    if (b !== h) rows.push({ file, base: b, head: h });
  }
  return { rows, js, css };
}

function bytes(n: number): string {
  return Math.abs(n) < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`;
}

function change(base: number, head: number): string {
  if (base === head) return "0";
  if (base === 0) return "new";
  if (head === 0) return "removed";
  const d = head - base;
  return `${d > 0 ? "+" : "-"}${bytes(Math.abs(d))} (${d > 0 ? "+" : ""}${((d / base) * 100).toFixed(1)}%)`;
}

export function sizeTable(c: Comparison, maxRows = 15): string {
  const lines = [MARKER, "### Bundle size (gzip)", ""];
  lines.push("| | Base | This PR | Change |", "| --- | --- | --- | --- |");
  lines.push(`| JS total | ${bytes(c.js.base)} | ${bytes(c.js.head)} | ${change(c.js.base, c.js.head)} |`);
  lines.push(`| CSS total | ${bytes(c.css.base)} | ${bytes(c.css.head)} | ${change(c.css.base, c.css.head)} |`);
  if (!c.rows.length) return [...lines, "", "No file changed size."].join("\n");
  const shown = [...c.rows].sort((a, b) => Math.abs(b.head - b.base) - Math.abs(a.head - a.base)).slice(0, maxRows);
  for (const r of shown) lines.push(`| \`${r.file}\` | ${bytes(r.base)} | ${bytes(r.head)} | ${change(r.base, r.head)} |`);
  if (c.rows.length > shown.length) lines.push("", `${c.rows.length - shown.length} more files changed size.`);
  return lines.join("\n");
}
