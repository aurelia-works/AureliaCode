// The UI scorecard (design/review/UI-RUBRIC.md) for `npm run ui-score`: the prompt a model scores
// screenshots with, and reading its answer back. The overall score is computed here, the mean
// of the categories, so it can't be inflated by the model. Pure, for `node --test`.

export const CATEGORIES = ["Typography", "Hierarchy", "Spacing", "Color and contrast", "Iconography", "Consistency", "Clarity", "Agent legibility"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Scorecard {
  categories: Partial<Record<Category, number>>;
  /** The line each category's score came from. */
  lines: Partial<Record<Category, string>>;
  missing: Category[];
  /** Mean of the categories to one decimal; 0 when any is missing. */
  score: number;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseScorecard(text: string): Scorecard {
  const categories: Partial<Record<Category, number>> = {};
  const lines: Partial<Record<Category, string>> = {};
  // The scores come before the FIX lines (scorePrompt); what follows can't rescore.
  const fix = text.search(/^[^A-Za-z\n]*FIX\b[^A-Za-z\n]*:/im);
  const scores = fix < 0 ? text : text.slice(0, fix);
  for (const c of CATEGORIES) {
    // Only a top-level line scores: the category at the start (after one list mark, a number or
    // bold marks) and a colon. A FIX line, an indented sub-point or a wrapped reason that
    // mentions a score can't change it.
    const re = new RegExp(`^(?:[-*>#]+[ \\t]*)?(?:\\d+[.)][ \\t]*)?[*_]*${escape(c).replace(" and ", " (?:and|&) ")}[*_ \\t]*:[*_ \\t]*(\\d+(?:\\.\\d+)?)[ \\t]*/[ \\t]*10\\b.*$`, "gim");
    for (const m of scores.matchAll(re)) {
      const n = Number(m[1]);
      if (n >= 0 && n <= 10) {
        categories[c] = n;
        lines[c] = m[0].trim();
      }
    }
  }
  const missing = CATEGORIES.filter((c) => categories[c] === undefined);
  const values = Object.values(categories) as number[];
  const score = missing.length ? 0 : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  return { categories, lines, missing, score };
}

export function scorePrompt(images: string[], rubric: string): string {
  return [
    "You are a harsh UI reviewer for AureliaCode, a macOS desktop app where people run coding agents in chat threads.",
    "Read each screenshot with the Read tool, then score the UI against the rubric. Judge what is on screen, not what the code might do.",
    "",
    "Screenshots:",
    ...images.map((p) => `- ${p}`),
    "",
    "Rubric:",
    rubric.trim(),
    "",
    "Answer with exactly one line per category, in this order, each with the main reason (name the element and where it is):",
    ...CATEGORIES.map((c) => `${c}: n/10 - reason`),
    "Then up to 5 lines starting with `FIX:`, the changes that would raise the score most, most important first.",
    "Don't write an overall score; it is computed from the categories.",
  ].join("\n");
}

/** `--min` as a score from 0 to 10, or null for anything else (a typo must not pass every run). */
export function parseMin(s: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(s.trim())) return null;
  const n = Number(s);
  return n <= 10 ? n : null;
}
