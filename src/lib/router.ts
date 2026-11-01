/**
 * Local model router: picks the model a team worker should run from the task, the harness
 * and what has already failed. No network, no randomness — the same inputs always give the
 * same answer, so a run can be replayed and its tests read like a table.
 *
 * Model names are whatever the caller passes in (`available`): Claude Code ids, Codex ids,
 * local names. Only their tier is inferred from the name, so new versions keep working.
 */

/** How much the user wants to spend on a run. `manual` means "use what the team says". */
export type Routing = "manual" | "cheap" | "balanced" | "best";

/** What kind of work the task is, from its wording. */
export type TaskKind = "review" | "research" | "mechanical" | "ui" | "test" | "build" | "general";

/** The harness a model belongs to, when its name says so. */
export type ModelHarness = "claude" | "codex" | "gemini" | "grok" | "deepseek" | "local";

export interface RouteRequest {
  task: string;
  /** The worker's harness, e.g. "claude" or "codex". Its own models are preferred. */
  harness?: string;
  /** Model ids that can run this harness. The first is the harness's own default. */
  available: string[];
  /** Models that already failed on this slice: they are not tried again. */
  failed?: string[];
  /** Defaults to "balanced". */
  routing?: Routing;
  /** A model the user (or the agent) picked; only used with `routing: "manual"`. */
  preferred?: string;
}

export interface Route {
  /** "" when there is nothing to run. */
  model: string;
  /** One line for the pane, the run record or a toast. */
  why: string;
}

/** Models a team run can route over when the caller has no catalogue of its own. */
export const DEFAULT_MODELS: Record<string, string[]> = {
  claude: ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-1"],
  codex: ["gpt-5-codex-mini", "gpt-5-codex"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
  grok: ["grok-3-mini", "grok-4"],
  deepseek: ["deepseek-v4.1-flash", "deepseek-v4.1"],
  local: ["qwen2.5-coder:1.5b", "qwen2.5-coder:7b", "llama3.3:70b"],
};

const KIND_RULES: [TaskKind, RegExp][] = [
  ["review", /\b(review|audit|critique|inspect|security|diff|regression)\b/],
  ["research", /\b(research|investigate|explore|compare|root cause|find out|spike|docs?)\b/],
  ["test", /\b(tests?|spec|coverage|fixture|flaky|assert\w*|jest|vitest|playwright)\b/],
  ["ui", /\b(ui|ux|css|styles?|design|layout|colour|color|responsive|accessib\w*|font|theme)\b/],
  ["mechanical", /\b(rename|format|fmt|lint|bump|typo|codemod|changelog|mechanical|boilerplate|move|delete)\b/],
  ["build", /\b(build|compile|bundle|package|packaging|ship|release|migrat\w*|deploy)\b/],
];

/** The task's kind, from the first matching rule; "general" when nothing matches. */
export function taskKind(task: string): TaskKind {
  const text = task.toLowerCase();
  for (const [kind, re] of KIND_RULES) if (re.test(text)) return kind;
  return "general";
}

const CHEAP = /(haiku|\bmini\b|flash|nano|small|\boss\b|local|qwen|llama|deepseek|1\.5b|\b[1-7]b\b)/;
const STRONG = /(opus|gpt-6|gpt-5\.5|o3(?!-mini)|codex-max|max)/;
const MID = /(sonnet|gpt-5(?!.*mini)|codex(?!.*mini)|gemini.*pro|grok-4|v4\.1(?!-flash))/;

/**
 * A model's strength: 2 cheap, 3 general, 4 balanced, 5 strongest. Cheap names win over
 * strong ones, so "gpt-5-codex-mini" is cheap even though it contains "codex".
 */
export function modelTier(model: string): number {
  const m = model.toLowerCase();
  if (CHEAP.test(m)) return 2;
  if (STRONG.test(m)) return 5;
  if (MID.test(m)) return 4;
  return 3;
}

export const TIER_LABEL: Record<number, string> = { 2: "cheap", 3: "general", 4: "balanced", 5: "strongest" };

/** The harness a model belongs to, when its name says so. */
export function modelHarness(model: string): ModelHarness | undefined {
  const m = model.toLowerCase();
  if (/(claude|opus|sonnet|haiku)/.test(m)) return "claude";
  if (/(gpt|codex|^o[34]\b)/.test(m)) return "codex";
  if (/gemini/.test(m)) return "gemini";
  if (/grok/.test(m)) return "grok";
  if (/deepseek/.test(m)) return "deepseek";
  if (/(qwen|llama)/.test(m)) return "local";
  return undefined;
}

/**
 * Balanced routing follows the task: a review wants the strongest model, a mechanical
 * edit the cheapest, UI work the balanced tier. Cheap and best override it outright.
 */
const KIND_ORDER: Record<TaskKind, number[]> = {
  review: [5, 4, 3, 2],
  research: [5, 4, 3, 2],
  mechanical: [2, 3, 4, 5],
  ui: [4, 5, 3, 2],
  test: [4, 3, 2, 5],
  build: [4, 3, 5, 2],
  general: [4, 3, 5, 2],
};

const orderFor = (kind: TaskKind, routing: Routing): number[] =>
  routing === "cheap" ? [2, 3, 4, 5] : routing === "best" ? [5, 4, 3, 2] : KIND_ORDER[kind];

/** Picks a model for one slice of work. Deterministic; treats an empty catalogue as no pick. */
export function routeModel(req: RouteRequest): Route {
  const routing = req.routing ?? "balanced";
  const available = [...new Set(req.available.filter(Boolean))];
  const failed = new Set(req.failed ?? []);
  const harness = req.harness?.toLowerCase();

  if (!available.length) return { model: "", why: "no model is available" };

  if (routing === "manual") {
    const pick = req.preferred && available.includes(req.preferred) ? req.preferred : undefined;
    if (pick && !failed.has(pick)) return { model: pick, why: `manual: ${pick} (picked in the team settings)` };
    const own = available.filter((m) => !failed.has(m) && (!harness || modelHarness(m) === harness));
    const model = own[0] ?? available.find((m) => !failed.has(m)) ?? available[0];
    return { model, why: pick ? `manual: ${pick} already failed, using ${model}` : `manual: ${model} (the harness's default)` };
  }

  // Every model the caller offered already failed: reuse the best of them rather than nothing.
  if (available.every((m) => failed.has(m))) {
    const kind = taskKind(req.task);
    const model = pick(available, kind, routing, harness) ?? available[0];
    return { model, why: `${routing}: every candidate failed, reusing ${model}` };
  }

  const kind = taskKind(req.task);
  const usable = available.filter((m) => !failed.has(m));
  const model = pick(usable, kind, routing, harness)!;
  const failedNote = failed.size ? `, ${failed.size} failed` : "";
  return { model, why: `${kind} task, ${routing}: ${model} (${TIER_LABEL[modelTier(model)]}${harness ? ` for ${harness}` : ""}${failedNote})` };
}

/** The first model in tier order; inside a tier, the harness's own models come first. */
function pick(available: string[], kind: TaskKind, routing: Routing, harness?: string): string | undefined {
  const tiers = orderFor(kind, routing);
  const sorted = [...available].sort((a, b) => {
    const ia = tiers.indexOf(modelTier(a));
    const ib = tiers.indexOf(modelTier(b));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  // Stable sort: same-tier models keep the caller's order. Prefer a harness match when asked.
  const own = harness ? sorted.filter((m) => modelHarness(m) === harness) : [];
  return own[0] ?? sorted[0];
}

/**
 * The next stronger model for a failed worker, or undefined when it already runs the
 * strongest one. One step only: teamRun caps escalation at one retry per worker.
 */
export function escalate(model: string, available: string[]): string | undefined {
  const current = modelTier(model);
  const pool = [...new Set(available)].filter((m) => modelTier(m) > current);
  if (!pool.length) return undefined;
  const lowest = Math.min(...pool.map(modelTier));
  return pool.find((m) => modelTier(m) === lowest);
}

/** The model catalogue for a harness; an empty list for an unknown one. */
export function modelsFor(harness: string | undefined): string[] {
  return (harness && DEFAULT_MODELS[harness]) || [];
}

/**
 * Which runtime an agent's launcher variant actually starts: "claude:work" and
 * "deepseek:claude" are Claude Code, "codex:oss" is Codex, "deepseek:opencode" is OpenCode.
 */
export function harnessOfVariant(variant: string): string {
  const [provider, backend] = variant.split(":");
  if (provider === "claude" || backend === "claude") return "claude";
  if (backend === "opencode") return "opencode";
  return provider;
}
