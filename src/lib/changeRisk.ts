/**
 * How risky a change is, from what it touches and how big it is, not from who wrote it
 * (Theo Browne, 2026-11-04: "the bot should be describing the severity of risk"). Low can
 * merge once checks are green; high wants a person to read it. Rules only, no imports.
 */

export type ChangeLevel = "low" | "medium" | "high";

export interface ChangeRisk {
  level: ChangeLevel;
  why: string[];
}

const HIGH_PATHS: [RegExp, string][] = [
  [/(^|\/)(auth|oauth|login|session|password|crypto|keychain|secrets?)([^/]*)(\/|$)/i, "touches auth or secrets"],
  [/(^|\/)(billing|payments?|stripe|invoices?)([^/]*)(\/|$)/i, "touches billing"],
  [/(^|\/)\.github\/workflows\//, "changes CI"],
  [/(^|\/)\.env(\.|$)/, "touches env files"],
  [/(^|\/)(migrations?)\//i, "changes a database schema"],
  [/(^|\/)(tauri[^/]*\.conf\.json|capabilities\/)/, "changes app permissions or config"],
];
const DEPS = /(^|\/)(package(-lock)?\.json|Cargo\.(toml|lock)|pnpm-lock\.yaml|yarn\.lock|go\.(mod|sum)|requirements[^/]*\.txt|pyproject\.toml|Gemfile(\.lock)?)$/;
const TEST = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[jt]sx?$|_test\.(rs|go|py)$/;
const MEDIUM_LINES = 300;
const HIGH_LINES = 1000;
const MANY_FILES = 20;

export function changeRisk(paths: string[], additions: number, deletions: number): ChangeRisk {
  if (paths.length > 0 && paths.every((p) => TEST.test(p))) return { level: "low", why: [] };
  const lines = additions + deletions;
  const high: string[] = [];
  const medium: string[] = [];
  if (lines > HIGH_LINES) high.push(`${lines} lines changed`);
  for (const [re, why] of HIGH_PATHS) if (paths.some((p) => re.test(p)) && !high.includes(why)) high.push(why);
  if (paths.some((p) => DEPS.test(p))) medium.push("changes dependencies");
  if (lines > MEDIUM_LINES && lines <= HIGH_LINES) medium.push(`${lines} lines changed`);
  if (paths.length > MANY_FILES) medium.push(`${paths.length} files`);
  if (high.length) return { level: "high", why: [...high, ...medium] };
  if (medium.length) return { level: "medium", why: medium };
  return { level: "low", why: [] };
}
