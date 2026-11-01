/** DeepSeek / Claude skill discovery. A skill is a folder with a SKILL.md whose frontmatter
 *  carries a name and description; the body is the procedure the agent follows. */

export interface Skill {
  /** `name:` from the frontmatter, or the folder name. */
  name: string;
  description: string;
  /** Absolute path to the skill folder. */
  path: string;
  /** Absolute path to its SKILL.md. */
  file: string;
  /** The procedure after the frontmatter. */
  body: string;
  /** The root the skill was found under. */
  root: string;
  /** `ds-` skills are the DeepSeek pack; they sort first. */
  deepseek: boolean;
}

export interface SkillRoot {
  path: string;
  label: string;
}

/**
 * The roots AureliaSpace looks in by default, best first. The GITHUB REPOS pack is the
 * owner's DeepSeek set; Settings → Skills can remove it or add another folder, and the
 * choice persists in skills.json.
 */
export const DEFAULT_SKILL_ROOTS: SkillRoot[] = [
  { path: "~/Downloads/PROJECTS/GITHUB REPOS/.agents/skills", label: "GITHUB REPOS" },
  { path: "~/.agents/skills", label: "Personal skills" },
  { path: "~/.claude/skills", label: "Claude skills" },
];

/** Parses the tiny YAML frontmatter used by SKILL.md: scalar `key: value` pairs only. */
export function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { data: {}, body: normalized.trim() };
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) return { data: {}, body: normalized.trim() };
  const head = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, "").trim();
  const data: Record<string, string> = {};
  for (const line of head.split("\n")) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    data[m[1]] = value.replace(/\\n/g, "\n");
  }
  return { data, body };
}

/** One SKILL.md. Returns null when the file is not a skill. */
export function parseSkill(text: string, folder: string, root: string): Skill | null {
  const { data, body } = parseFrontmatter(text);
  const fallback = folder.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "skill";
  const name = (data.name || fallback).trim();
  if (!name) return null;
  const description = (data.description || firstParagraph(body) || "").trim();
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  return {
    name,
    description,
    path: folder,
    file: `${folder.replace(/[\\/]+$/, "")}/SKILL.md`,
    body,
    root: normalizedRoot,
    deepseek: /(^|[/\\])ds-/.test(name) || /\.agents[/\\]skills/.test(normalizedRoot),
  };
}

function firstParagraph(body: string): string {
  const line = body.split("\n").find((l) => l.trim() && !l.trim().startsWith("#"));
  return line?.trim().slice(0, 240) ?? "";
}

/** Pinned first (ds-swarm, then other ds-*), then alphabetical. */
export function sortSkills(skills: Skill[]): Skill[] {
  const rank = (s: Skill) => (s.name === "ds-swarm" ? 0 : s.name.startsWith("ds-") ? 1 : 2);
  return [...skills].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Search over name, description and body, case-insensitive. */
export function filterSkills(skills: Skill[], query: string): Skill[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((s) => `${s.name} ${s.description} ${s.body}`.toLowerCase().includes(q));
}

/** The prompt a worker gets: the skill procedure, then the task. */
export function skillPrompt(skill: Skill, task: string): string {
  const goal = task.trim();
  return [
    `Use the ${skill.name} skill. Follow its procedure exactly.`,
    "",
    `Skill: ${skill.name}`,
    skill.description ? `When to use it: ${skill.description}` : "",
    "",
    skill.body,
    "",
    goal ? `Task:\n${goal}` : "Task: ask me what to run before starting.",
    "",
    "Report PASS, ISSUES or BLOCKED with the commands you ran and their output.",
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n")
    .trim();
}

/** A compact one-line label for a skill chip. */
export function skillLabel(skill: Skill): string {
  return skill.name.replace(/^ds-/, "").replace(/-/g, " ");
}
