import { modelHarness, modelTier, modelsFor, routeModel, taskKind, type Routing, type TaskKind } from "./router.ts";

/**
 * A team run, as pure data: one lead, up to three workers, and the prompts that go into
 * their panes. Nothing here touches the app or the network, so a plan and its prompts can
 * be tested with `node --test` (src/lib/teamRun.test.ts) and replay exactly.
 */

/** The part of a saved agent a plan needs; resolved by lib/runTeam from store/customAgents. */
export interface TeamAgent {
  id: string;
  name: string;
  /** "claude", "codex", "gemini"… from the agent's launcher variant. */
  harness?: string;
  /** A model the user pinned on the agent; used with manual routing. */
  model?: string;
}

/** The part of a saved team a plan needs; the store's AgentTeam fits this shape. */
export interface TeamSpec {
  id: string;
  name: string;
  /** Agent ids in pane order; repeats are allowed. */
  agentIds: string[];
  /** Whose pane leads the run. Defaults to the first member. */
  leadId?: string;
  routing?: Routing;
  /** Panes at once, lead included. Default 4 (lead + three workers). */
  maxConcurrency?: number;
  /** Resolved members, in agentIds order. */
  agents?: TeamAgent[];
}

export interface TeamWorker {
  agentId: string;
  /** What this worker owns: reviewer, builder, tester, researcher… */
  role: string;
  /** The router's pick for this slice, when a catalogue was given. */
  model?: string;
}

export interface TeamPlan {
  /** "" when the team has no resolvable members. */
  leadId: string;
  workers: TeamWorker[];
  maxConcurrency: number;
}

export interface RunResult {
  agentId: string;
  status: "PASS" | "ISSUES" | "BLOCKED";
  /** One line of evidence for the summary. */
  summary?: string;
}

export interface RunSummary {
  status: "PASS" | "ISSUES" | "BLOCKED";
  counts: Record<"PASS" | "ISSUES" | "BLOCKED", number>;
  lines: string[];
  text: string;
}

const MAX_WORKERS = 3;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 8;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Three roles that fit the kind of work, in the order workers get them. */
const ROLES: Record<TaskKind, [string, string, string]> = {
  review: ["reviewer", "security reviewer", "verifier"],
  research: ["researcher", "cross-checker", "reproducer"],
  mechanical: ["patcher", "verifier", "checker"],
  ui: ["designer", "accessibility checker", "verifier"],
  test: ["test writer", "fixture builder", "verifier"],
  build: ["builder", "verifier", "packager"],
  general: ["builder", "reviewer", "verifier"],
};

const SLICES: Record<string, string> = {
  reviewer: "read the change and the code around it; report bugs and regressions with file:line; edit nothing",
  "security reviewer": "look for secrets, unquoted input, path traversal and unsafe shell use; report with file:line; edit nothing",
  verifier: "prove the work: run the checks, read the diff and report what actually ran",
  researcher: "answer the question from the code and docs; cite file:line or command output",
  "cross-checker": "independently confirm or contradict the researcher; say which claim you could not verify",
  reproducer: "build the smallest reproduction and show the failing command and its output",
  patcher: "make the smallest change that finishes the slice; no unrelated edits",
  checker: "compare the diff against the slice; list anything extra or missing",
  designer: "keep the change inside the existing design language; verify with a screenshot",
  "accessibility checker": "keyboard path, focus, names and contrast; report each with the control it affects",
  "test writer": "add or fix only the tests this slice needs; show the failing test first",
  "fixture builder": "build the smallest deterministic fixture the tests need; no network",
  builder: "implement the slice end to end, then run it",
  packager: "check the build and the bundle; report size or config problems",
};

const VERIFY: Record<TaskKind, string> = {
  review: "run the checks the change affects and read `git diff HEAD`; a finding without file:line is not a finding",
  research: "cite the file:line or the command output that proves each claim",
  mechanical: "run the type check and the tests that cover the files you touched",
  ui: "check the screen in the preview harness, keyboard only, at a narrow and a wide width",
  test: "run the new tests before and after the fix; paste both counts",
  build: "run the project's build and tests; paste the result lines",
  general: "run the type check, tests and build the project already has; paste the result lines",
};

export const teamRouting = (team: TeamSpec): Routing => team.routing ?? "balanced";

export const teamConcurrency = (team: TeamSpec): number =>
  clamp(team.maxConcurrency ?? 4, MIN_CONCURRENCY, MAX_CONCURRENCY);

/** Stable order with repeats removed. */
function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}

/**
 * Builds a lead plus up to three workers from a team. Workers are picked so different
 * harnesses come first (Claude + Codex + Gemini rather than three Claudes), the worker
 * count respects `maxConcurrency` (lead included) and each worker gets a role and, when a
 * model catalogue is passed, a routed model.
 */
export function planTeam(team: TeamSpec, task: string, routing: Routing, available: string[] = []): TeamPlan {
  const maxConcurrency = teamConcurrency(team);
  const agents = (team.agents ?? []).filter((a) => team.agentIds.includes(a.id));
  const byId = new Map(agents.map((a) => [a.id, a]));
  const members = unique(team.agentIds).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  if (!members.length) return { leadId: "", workers: [], maxConcurrency };

  const lead = members.find((a) => a.id === team.leadId) ?? members[0];
  const rest = members.filter((a) => a.id !== lead.id);
  const room = Math.max(0, Math.min(MAX_WORKERS, maxConcurrency - 1, rest.length));
  const kind = taskKind(task);
  const roles = ROLES[kind];

  // Round-robin across harnesses so a 3-worker run uses as many runtimes as the team has.
  const groups = new Map<string, TeamAgent[]>();
  for (const a of rest) {
    const key = a.harness ?? "other";
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const queues = [...groups.values()];
  const mixed: TeamAgent[] = [];
  for (let i = 0; mixed.length < rest.length; i++) {
    for (const q of queues) {
      if (q[i] && mixed.length < rest.length) mixed.push(q[i]);
    }
  }
  const chosen = mixed.slice(0, room);

  const workers = chosen.map((agent, i) => {
    const own = agent.harness ? available.filter((m) => modelHarness(m) === agent.harness || modelsFor(agent.harness!).includes(m)) : available;
    const routed = routeModel({
      task,
      harness: agent.harness,
      available: own.length ? own : available,
      routing,
      preferred: agent.model,
    });
    return { agentId: agent.id, role: roles[i % roles.length], ...(routed.model ? { model: routed.model } : {}) };
  });

  return { leadId: lead.id, workers, maxConcurrency };
}

const nameOf = (team: TeamSpec | undefined, id: string) => team?.agents?.find((a) => a.id === id)?.name ?? id;
const harnessOf = (team: TeamSpec | undefined, id: string) => team?.agents?.find((a) => a.id === id)?.harness;

const modelLine = (worker: TeamWorker) =>
  worker.model ? ` Suggested model: ${worker.model} (tier ${modelTier(worker.model)}). Switch with /model if you are not on it.` : "";

/** The prompt that opens the lead's chat pane: goal, slices, how to drive the workers, report shape. */
export function leadPrompt(plan: TeamPlan, task: string, team?: TeamSpec): string {
  const kind = taskKind(task);
  const workers = plan.workers.length
    ? plan.workers
        .map(
          (w, i) =>
            `${i + 1}. ${w.role} — ${nameOf(team, w.agentId)}` +
            `${harnessOf(team, w.agentId) ? ` (${harnessOf(team, w.agentId)})` : ""}` +
            `${w.model ? ` on ${w.model}` : ""}`,
        )
        .join("\n")
    : "No workers: the team has no one else, so do the work yourself.";

  return [
    `Goal: ${task}`,
    "",
    `You are ${plan.leadId ? nameOf(team, plan.leadId) : "the lead"}, the lead of this team run (${kind} work). Split the goal into the slices below, one per worker, and keep the whole run moving.`,
    "",
    "Workers:",
    workers,
    "",
    "How to drive them:",
    "- Each worker already has its own pane and a slice prompt. Check on its pane with aurelia_list_panes and aurelia_read_pane.",
    "- If a worker's pane is missing, open one with aurelia_open_pane and give it the slice prompt. Send a correction, or the next slice, with aurelia_send_to_pane.",
    "- One slice per worker, and no two workers editing the same files.",
    "- If a worker reports BLOCKED, retry that slice once on a stronger model (or do it yourself), then move on. One escalation per worker, never a loop.",
    "- Do not commit, reset, stash or clean anything.",
    "",
    `Verify before you report: ${VERIFY[kind]}.`,
    "",
    "Report in exactly this shape:",
    "LEAD: PASS | ISSUES | BLOCKED — one line",
    "PASS: <slice> — <evidence>",
    "ISSUES: <file:line> — <what is wrong and what must change>",
    "BLOCKED: <slice> — <what you need from the human>",
    "",
    `When the run is over, call aurelia_team_status with team "${team?.id ?? ""}" to get the run id, then call aurelia_team_finish with that id, the verdict (done, blocked or failed) and this report.`,
  ].join("\n");
}

/** One worker's standalone prompt: the same goal, its slice, how to verify, and the report shape. */
export function workerPrompt(plan: TeamPlan, worker: TeamWorker, task: string, team?: TeamSpec): string {
  const kind = taskKind(task);
  const name = nameOf(team, worker.agentId);
  const lead = plan.leadId ? nameOf(team, plan.leadId) : "the lead";
  return [
    `Goal: ${task}`,
    "",
    `You are ${name}, the ${worker.role} in a team run led by ${lead}. Your slice: ${SLICES[worker.role] ?? SLICES.builder}.`,
    "Work only inside that slice; the other workers own the rest. If the slice is bigger than one turn, say what you finished and what is left in the report.",
    "",
    `Verify: ${VERIFY[kind]}.${modelLine(worker)}`,
    "",
    "Do not commit, reset, stash or clean. Report evidence, not plans.",
    "",
    "Report in exactly this shape:",
    "STATUS: PASS | ISSUES | BLOCKED",
    "DID: one line",
    "EVIDENCE: the command you ran or the file:line you checked",
    "NEEDED: only for BLOCKED — what the human or lead must decide",
  ].join("\n");
}

/** Merges worker reports into one verdict: any BLOCKED wins, then ISSUES, then PASS. */
export function summarizeRun(plan: TeamPlan, results: RunResult[]): RunSummary {
  const counts = { PASS: 0, ISSUES: 0, BLOCKED: 0 } as Record<"PASS" | "ISSUES" | "BLOCKED", number>;
  const lines: string[] = [];
  const seen = new Set<string>();

  for (const worker of plan.workers) {
    const result = results.find((r) => r.agentId === worker.agentId);
    seen.add(worker.agentId);
    if (!result) {
      counts.BLOCKED++;
      lines.push(`${worker.role} — BLOCKED — no report yet`);
      continue;
    }
    counts[result.status]++;
    lines.push(`${worker.role} — ${result.status}${result.summary ? ` — ${result.summary}` : ""}`);
  }
  // Reports from agents that weren't in the plan still count: a worker can be opened later.
  for (const result of results) {
    if (seen.has(result.agentId)) continue;
    counts[result.status]++;
    lines.push(`${result.agentId} — ${result.status}${result.summary ? ` — ${result.summary}` : ""}`);
  }

  const status: RunSummary["status"] = counts.BLOCKED ? "BLOCKED" : counts.ISSUES ? "ISSUES" : "PASS";
  const head = !plan.workers.length && status === "PASS" ? "OVERALL: PASS — the lead ran alone" : `OVERALL: ${status}`;
  return { status, counts, lines, text: [head, ...lines].join("\n") };
}
