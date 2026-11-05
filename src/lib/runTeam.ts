import { useConfig } from "../store/config";
import { useCustomAgents, type AgentTeam } from "../store/customAgents";
import { focusedPaneId, useLayout, type NewPaneOpts } from "../store/layout";
import { useTeamRuns } from "../store/teamRuns";
import { toast } from "../store/ui";
import { prepareCustomAgent } from "./agents";
import { queueFirstMessage } from "./chat";
import { startDir } from "./launch";
import { DEFAULT_MODELS, harnessOfVariant, modelsFor } from "./router";
import { leadPrompt, planTeam, teamRouting, workerPrompt, type TeamPlan, type TeamSpec } from "./teamRun";
import { queueInit, submitToPane } from "./terminals";

export interface RunTeamOptions {
  /** Starting folder; default the focused pane's folder. */
  folder?: string;
  /** Give the lead and each worker its own git worktree. */
  worktree?: boolean;
  /** Model ids the router may pick from; default is this app's catalogue for the team's harnesses. */
  available?: string[];
}

const slug = (s: string) =>
  s
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 40) || "team";

/** The model catalogue for the harnesses a team actually uses. */
function catalogueFor(agents: { harness?: string }[], override?: string[]): string[] {
  if (override?.length) return [...new Set(override)];
  const harnesses = [...new Set(agents.map((a) => a.harness).filter((h): h is string => !!h))];
  const own = harnesses.flatMap((h) => modelsFor(h));
  return [...new Set(own.length ? own : Object.values(DEFAULT_MODELS).flat())];
}

/** A terminal worker's prompt goes in once its agent CLI is up; chats get it before the spawn. */
function sendWhenReady(paneId: string, text: string, tries = 15) {
  const attempt = () => {
    if (!useLayout.getState().panes[paneId]) return;
    if (submitToPane(paneId, text)) return;
    if (tries-- > 0) setTimeout(attempt, 800);
  };
  setTimeout(attempt, 2500);
}

/**
 * Starts a team run: a lead chat pane on the lead prompt, then one pane per worker on its
 * slice prompt. Records the run (store/teamRuns) so the agent view and `aurelia_team_status`
 * can see it after the panes move on. Returns the run id, or undefined when nothing started.
 */
export async function runTeam(team: AgentTeam, task: string, opts: RunTeamOptions = {}): Promise<string | undefined> {
  const goal = task.trim();
  if (!goal) {
    toast("Type what the team should do first.", true);
    return undefined;
  }

  const saved = useCustomAgents.getState().agents;
  const agents = [...new Map(team.agentIds.flatMap((id) => saved.filter((a) => a.id === id)).map((a) => [a.id, a])).values()];
  if (!agents.length) {
    toast(`${team.name} has no agents. Add some in Settings → Agents.`, true);
    return undefined;
  }

  const spec: TeamSpec = {
    ...team,
    agents: agents.map((a) => ({ id: a.id, name: a.name, harness: harnessOfVariant(a.variant) })),
  };
  const routing = teamRouting(spec);
  const plan = planTeam(spec, goal, routing, catalogueFor(spec.agents ?? []));
  if (!plan.leadId) {
    toast(`${team.name} has no agent to lead the run.`, true);
    return undefined;
  }

  const from = focusedPaneId();
  const base = opts.folder ?? (from ? useLayout.getState().panes[from]?.cwd : undefined);
  const leadAgent = agents.find((a) => a.id === plan.leadId)!;
  // The lead is always a Claude chat pane (the only chat harness today); its own account when it has one.
  const leadAccount = leadAgent.variant.startsWith("claude:") ? leadAgent.variant.slice("claude:".length) : undefined;
  const accounts = useConfig.getState().config?.accounts.map((a) => a.name) ?? [];
  const account = leadAccount && accounts.includes(leadAccount) ? leadAccount : accounts[0];
  const leadCwd = await startDir(base, !!opts.worktree, slug(`${team.name}-lead`));
  const leadPane = useLayout.getState().newTab({
    account,
    cwd: leadCwd,
    mode: "chat",
    customAgent: leadAgent.id,
  });

  // Prepare the workers one at a time: concurrent `git worktree add` calls fight over the repo lock.
  const prepared: { worker: TeamPlan["workers"][number]; plan: { opts: NewPaneOpts; command?: string } }[] = [];
  for (const worker of plan.workers) {
    const agent = agents.find((a) => a.id === worker.agentId);
    if (!agent) continue;
    const planForAgent = await prepareCustomAgent(opts.worktree ? { ...agent, worktree: true } : agent, base);
    if (planForAgent) prepared.push({ worker, plan: planForAgent });
  }
  const finalPlan: TeamPlan = { ...plan, workers: prepared.map((p) => p.worker) };
  // Enforce the router's pick on chat workers; a terminal harness keeps its own CLI model.
  for (const p of prepared) {
    if (p.plan.opts.mode === "chat" && p.worker.model) p.plan.opts.chatModel = p.worker.model;
  }

  const workerPanes = prepared.length ? useLayout.getState().newPanesTab(prepared.map((p) => p.plan.opts)) : [];
  workerPanes.forEach((paneId, i) => {
    const { worker, plan: launch } = prepared[i];
    const prompt = workerPrompt(finalPlan, worker, goal, spec);
    if (launch.opts.mode === "chat") queueFirstMessage(paneId, prompt);
    else {
      if (launch.command) queueInit(paneId, launch.command);
      sendWhenReady(paneId, prompt);
    }
  });

  // Record the run before the lead can call aurelia_team_status for its id.
  const runId = useTeamRuns.getState().start({
    teamId: team.id,
    task: goal,
    plan: finalPlan,
    paneIds: [leadPane, ...workerPanes],
    status: "running",
    summary: "",
  });
  queueFirstMessage(leadPane, leadPrompt(finalPlan, goal, spec));
  useLayout.getState().focusPane(leadPane);
  toast(`Team ${team.name} started: lead + ${finalPlan.workers.length} worker${finalPlan.workers.length === 1 ? "" : "s"}`);
  return runId;
}
