import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MODELS } from "./router.ts";
import { leadPrompt, planTeam, summarizeRun, teamConcurrency, teamRouting, workerPrompt, type TeamAgent, type TeamSpec } from "./teamRun.ts";

const available = [...DEFAULT_MODELS.claude, ...DEFAULT_MODELS.codex, ...DEFAULT_MODELS.gemini];
const AGENTS: TeamAgent[] = [
  { id: "a1", name: "Architect", harness: "claude" },
  { id: "a2", name: "Second pair of eyes", harness: "claude" },
  { id: "a3", name: "Codex runner", harness: "codex" },
  { id: "a4", name: "Gemini runner", harness: "gemini" },
];
const TEAM: TeamSpec = {
  id: "t1",
  name: "Ship it",
  agentIds: ["a1", "a2", "a3", "a4"],
  leadId: "a1",
  routing: "balanced",
  maxConcurrency: 4,
  agents: AGENTS,
};

test("a plan has the picked lead and up to three workers on different harnesses", () => {
  const plan = planTeam(TEAM, "Review the auth diff and run the tests", "balanced", available);
  assert.equal(plan.leadId, "a1");
  assert.equal(plan.workers.length, 3);
  assert.deepEqual(
    plan.workers.map((w) => w.agentId),
    ["a2", "a3", "a4"],
  );
  assert.deepEqual(
    plan.workers.map((w) => w.role),
    ["reviewer", "security reviewer", "verifier"],
  );
  const harnesses = plan.workers.map((w) => AGENTS.find((a) => a.id === w.agentId)!.harness);
  assert.equal(new Set(harnesses).size, 3, "one worker per harness first");
});

test("maxConcurrency counts the lead and caps the workers", () => {
  assert.equal(planTeam({ ...TEAM, maxConcurrency: 2 }, "build it", "balanced", available).workers.length, 1);
  assert.equal(planTeam({ ...TEAM, maxConcurrency: 1 }, "build it", "balanced", available).workers.length, 0);
  assert.equal(planTeam({ ...TEAM, maxConcurrency: 99 }, "build it", "balanced", available).workers.length, 3);
});

test("an old team without the new fields still plans", () => {
  const old: TeamSpec = { id: "t0", name: "Old", agentIds: ["a1", "a2"], agents: AGENTS };
  assert.equal(teamRouting(old), "balanced");
  assert.equal(teamConcurrency(old), 4);
  const plan = planTeam(old, "rename the helper", "balanced", available);
  assert.equal(plan.leadId, "a1");
  assert.equal(plan.workers.length, 1);
  assert.equal(plan.workers[0].model, "claude-haiku-4-5");
});

test("the lead is the first member when leadId is missing or gone", () => {
  assert.equal(planTeam({ ...TEAM, leadId: undefined }, "build", "balanced", available).leadId, "a1");
  assert.equal(planTeam({ ...TEAM, leadId: "missing" }, "build", "balanced", available).leadId, "a1");
});

test("workers are routed per harness; a team with no agents plans nothing", () => {
  const plan = planTeam(TEAM, "review the diff", "balanced", available);
  assert.equal(plan.workers[0].model, "claude-opus-4-1");
  assert.equal(plan.workers[1].model, "gpt-5-codex");
  assert.equal(plan.workers[2].model, "gemini-2.5-pro");
  assert.deepEqual(planTeam({ ...TEAM, agents: [] }, "review", "balanced", available), { leadId: "", workers: [], maxConcurrency: 4 });
});

test("the lead prompt has the goal, the workers, the pane tools and the report shape", () => {
  const plan = planTeam(TEAM, "Review the auth diff", "balanced", available);
  const prompt = leadPrompt(plan, "Review the auth diff", TEAM);
  for (const bit of ["Goal: Review the auth diff", "Architect", "reviewer", "aurelia_list_panes", "aurelia_read_pane", "aurelia_open_pane", "aurelia_send_to_pane", "LEAD: PASS | ISSUES | BLOCKED", "ISSUES:", "BLOCKED:", "One escalation per worker"]) {
    assert.ok(prompt.includes(bit), bit);
  }
});

test("the worker prompt is standalone: slice, verification and report", () => {
  const plan = planTeam(TEAM, "Make the settings page keyboard accessible", "balanced", available);
  const worker = plan.workers[0];
  const prompt = workerPrompt(plan, worker, "Make the settings page keyboard accessible", TEAM);
  for (const bit of ["Goal: Make the settings page keyboard accessible", "designer", "Your slice:", "Verify:", "Suggested model:", "STATUS: PASS | ISSUES | BLOCKED", "EVIDENCE:", "Do not commit"]) {
    assert.ok(prompt.includes(bit), bit);
  }
});

test("summaries merge PASS, ISSUES and BLOCKED, worst first", () => {
  const plan = planTeam(TEAM, "review", "balanced", available);
  const [a, b, c] = plan.workers;

  const pass = summarizeRun(plan, [
    { agentId: a.agentId, status: "PASS", summary: "clean" },
    { agentId: b.agentId, status: "PASS", summary: "no secrets" },
    { agentId: c.agentId, status: "PASS", summary: "tests pass" },
  ]);
  assert.equal(pass.status, "PASS");
  assert.deepEqual(pass.counts, { PASS: 3, ISSUES: 0, BLOCKED: 0 });
  assert.match(pass.text, /^OVERALL: PASS/);

  const issues = summarizeRun(plan, [
    { agentId: a.agentId, status: "PASS" },
    { agentId: b.agentId, status: "ISSUES", summary: "leaks a token" },
    { agentId: c.agentId, status: "PASS" },
  ]);
  assert.equal(issues.status, "ISSUES");
  assert.equal(issues.counts.ISSUES, 1);
  assert.ok(issues.lines.some((l) => l.includes("leaks a token")));

  const blocked = summarizeRun(plan, [
    { agentId: a.agentId, status: "ISSUES" },
    { agentId: b.agentId, status: "BLOCKED", summary: "needs a decision" },
    { agentId: c.agentId, status: "PASS" },
  ]);
  assert.equal(blocked.status, "BLOCKED");
  assert.deepEqual(blocked.counts, { PASS: 1, ISSUES: 1, BLOCKED: 1 });
});

test("a worker with no report counts as blocked", () => {
  const plan = planTeam(TEAM, "review", "balanced", available);
  const summary = summarizeRun(plan, [{ agentId: plan.workers[0].agentId, status: "PASS" }]);
  assert.equal(summary.status, "BLOCKED");
  assert.equal(summary.counts.BLOCKED, 2);
  assert.ok(summary.lines.some((l) => l.includes("no report yet")));
});

test("a lead on its own passes", () => {
  const plan = planTeam({ ...TEAM, maxConcurrency: 1 }, "review", "balanced", available);
  const summary = summarizeRun(plan, []);
  assert.equal(summary.status, "PASS");
  assert.match(summary.text, /the lead ran alone/);
});
