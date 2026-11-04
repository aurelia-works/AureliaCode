#!/usr/bin/env node
// Scores preview-harness screenshots against design/review/UI-RUBRIC.md with a Claude model, and
// prints one line per category plus `SCORE: n/10` (the mean). A thread goal can use it as its
// check, so an agent keeps improving the UI until it reaches a score:
//
//   npm run ui-score -- chat,start            views to score (default: chat)
//   npm run ui-score -- chat --model sonnet   reviewer model (default: haiku)
//   npm run ui-score -- chat --min 7          exit 1 below 7 (default 8, the rubric's ship bar)
//
// Uses the `claude` CLI and your Claude account: each run is one model call.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { viewSlug } from "../src/lib/previewViews.ts";
import { CATEGORIES, parseMin, parseScorecard, scorePrompt } from "../src/lib/uiScore.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const views = (args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "chat").split(",").map((v) => v.trim()).filter(Boolean);
const model = opt("model", "haiku");
const min = parseMin(opt("min", "8"));
if (min === null) {
  console.error(`--min takes a score from 0 to 10, not "${opt("min", "")}"`);
  process.exit(2);
}
const out = ".shots/score";

execFileSync(process.execPath, [join(root, "scripts/preview-shots.mjs"), "--no-before", "--views", views.join(","), "--out", out], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
const images = views.map((v) => join(out, `${viewSlug(v)}-after.png`));
const prompt = scorePrompt(images, readFileSync(join(root, "design/review/UI-RUBRIC.md"), "utf8"));
let answer;
try {
  answer = execFileSync("claude", ["-p", "--model", model, "--allowedTools", "Read", "--output-format", "text", prompt], { cwd: root, encoding: "utf8", maxBuffer: 8 << 20, timeout: 10 * 60_000 });
} catch (e) {
  console.error(`The reviewer didn't answer: ${String(e.stderr || e.message).trim().slice(-500)}`);
  process.exit(2);
}
const card = parseScorecard(answer);
for (const c of CATEGORIES) console.log(card.lines[c] ?? `${c}: missing`);
for (const l of answer.split("\n").filter((l) => /^[^A-Za-z\n]*FIX\b[^A-Za-z\n]*:/i.test(l))) console.log(l.trim());
if (card.missing.length) console.log(`Missing from the review: ${card.missing.join(", ")}`);
console.log(`SCORE: ${card.score}/10 (${model}, ${views.join(", ")})`);
if (card.score < min) process.exit(1);
