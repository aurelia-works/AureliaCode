import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { visualOf } from "../components/StatusGlyph";
import { paneTitle } from "../components/TitleBar";
import { useAgents } from "../store/agents";
import { useConfig } from "../store/config";
import { useCustomAgents } from "../store/customAgents";
import { paneIds, useLayout } from "../store/layout";
import { useRuntime } from "../store/runtime";
import { useTasks, type Task, type TaskStatus } from "../store/tasks";
import { useTeamRuns } from "../store/teamRuns";
import { openInBrowserPane } from "./browser";
import { sendPrompt } from "./effort";
import { expandPath } from "./format";
import { ipc } from "./ipc";
import { shellQuote } from "./launch";
import { enqueue } from "./outbox";
import { useUi } from "../store/ui";
import { chatText, queueFirstMessage, sendChat, useChat } from "./chat";
import { getEntry, queueInit, submitToPane } from "./terminals";

/**
 * Answers the `aurelia_*` tools Claude panes call (src-tauri/src/control.rs): list, read
 * and message panes, open Claude panes, and show an HTML page in a browser pane.
 */
interface Request {
  id: number;
  method: string;
  params: Record<string, unknown>;
  /** The calling pane (AURELIA_PANE_ID), when known. */
  from: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** MCP-facing status names map onto the task store's three states. */
const TASK_STATUS: Record<string, TaskStatus> = {
  todo: "todo",
  pending: "todo",
  open: "todo",
  doing: "doing",
  "in-progress": "doing",
  in_progress: "doing",
  active: "doing",
  review: "doing",
  done: "done",
  complete: "done",
  completed: "done",
};

function taskStatus(v: unknown): TaskStatus {
  const status = TASK_STATUS[str(v).toLowerCase()];
  if (!status) throw new Error(`unknown task status "${str(v)}" (todo, doing or done)`);
  return status;
}

/** A task by id, in a named project or anywhere. */
function findTask(id: string, project?: string) {
  const projects = useTasks.getState().projects;
  for (const key of project ? [project] : Object.keys(projects)) {
    const task = (projects[key] ?? []).find((t) => t.id === id);
    if (task) return { project: key, task };
  }
  return undefined;
}

const taskRow = (project: string, task: Task) => ({
  id: task.id,
  project,
  title: task.title,
  status: task.status,
  pane: task.paneId,
  createdAt: task.createdAt,
});

/** The project a task belongs to: explicit, else the calling pane's git root (or cwd). */
async function taskProject(params: Record<string, unknown>, from: string): Promise<string> {
  const explicit = str(params.project);
  if (explicit) return explicit;
  const layout = useLayout.getState();
  const cwd = layout.panes[from]?.cwd ?? useAgents.getState().sessions[from]?.cwd;
  if (!cwd) throw new Error("project is required when the calling pane has no folder");
  return ipc.projectRoot(cwd).catch(() => cwd);
}

async function taskAdd(from: string, params: Record<string, unknown>) {
  const title = str(params.title).trim();
  if (!title) throw new Error("title is required");
  const project = await taskProject(params, from);
  const pane = str(params.pane) || undefined;
  const status = params.status === undefined ? "todo" : taskStatus(params.status);
  useTasks.getState().add(project, title, pane);
  const list = useTasks.getState().projects[project] ?? [];
  const task = list[list.length - 1];
  if (status !== "todo") useTasks.getState().setStatus(project, task.id, status);
  return taskRow(project, { ...task, status });
}

function taskList(params: Record<string, unknown>) {
  const projects = useTasks.getState().projects;
  const only = str(params.project);
  const status = params.status === undefined ? undefined : taskStatus(params.status);
  const rows = (only ? [[only, projects[only] ?? []] as const] : Object.entries(projects)).flatMap(([project, list]) =>
    list.filter((t) => !status || t.status === status).map((t) => taskRow(project, t)),
  );
  return rows.slice(0, 400);
}

function taskUpdate(params: Record<string, unknown>) {
  const id = str(params.id);
  if (!id) throw new Error("id is required");
  const found = findTask(id, str(params.project) || undefined);
  if (!found) throw new Error(`no task ${id}`);
  const { project } = found;
  const tasks = useTasks.getState();
  if (params.title !== undefined) tasks.rename(project, id, str(params.title));
  if (params.status !== undefined) tasks.setStatus(project, id, taskStatus(params.status));
  if (params.pane !== undefined) tasks.attach(project, id, str(params.pane) || undefined);
  const next = (useTasks.getState().projects[project] ?? []).find((t) => t.id === id)!;
  return taskRow(project, next);
}

function teamStatus(params: Record<string, unknown>) {
  const runId = str(params.run);
  const teamId = str(params.team);
  const runs = useTeamRuns.getState().runs.filter((r) => (!runId || r.id === runId) && (!teamId || r.teamId === teamId));
  if (runId && !runs.length) throw new Error(`no team run ${runId}`);
  const teams = useCustomAgents.getState().teams;
  const agents = useCustomAgents.getState().agents;
  return runs.slice(0, 50).map((r) => ({
    run: r.id,
    team: teams.find((t) => t.id === r.teamId)?.name ?? r.teamId,
    task: r.task,
    status: r.status,
    createdAt: r.createdAt,
    summary: r.summary,
    lead: agents.find((a) => a.id === r.plan.leadId)?.name ?? r.plan.leadId,
    panes: r.paneIds,
    workers: r.plan.workers.map((w) => ({
      agent: agents.find((a) => a.id === w.agentId)?.name ?? w.agentId,
      role: w.role,
      model: w.model,
    })),
  }));
}

function teamFinish(params: Record<string, unknown>, from: string) {
  const run = str(params.run);
  if (!run) throw new Error("run is required");
  const record = useTeamRuns.getState().runs.find((r) => r.id === run);
  if (!record) throw new Error(`no team run ${run}`);
  if (record.paneIds[0] !== from) throw new Error("only the lead pane can finish this team run");
  if (record.status !== "running") throw new Error(`that team run is already ${record.status}`);
  const status = str(params.status);
  if (!["done", "blocked", "failed"].includes(status)) throw new Error("status must be done, blocked or failed");
  const summary = str(params.summary).trim();
  if (!summary) throw new Error("summary is required: the merged PASS/ISSUES/BLOCKED report");
  useTeamRuns.getState().finish(run, status as "done" | "blocked" | "failed", summary);
  return teamStatus({ run });
}

function listPanes(from: string) {
  const { tabs, panes } = useLayout.getState();
  const sessions = useAgents.getState().sessions;
  const runtime = useRuntime.getState().panes;
  return tabs.flatMap((tab, i) =>
    paneIds(tab.root).flatMap((id) => {
      const pane = panes[id];
      if (!pane || pane.browser || pane.editor || pane.launcher) return [];
      const s = sessions[id];
      const cwd = s?.cwd ?? pane.cwd;
      return [
        {
          id,
          self: id === from || undefined,
          title: s ? "claude" : paneTitle(cwd, runtime[id]?.running),
          cwd,
          account: s?.account ?? pane.account,
          status: s ? visualOf(s) : "shell",
          waitingOn: s?.status === "needs_input" ? s.message : undefined,
          tab: i + 1,
        },
      ];
    }),
  );
}

function readPane(paneId: string, lines: number): string {
  if (useLayout.getState().panes[paneId]?.mode === "chat") return chatText(paneId, lines);
  const term = getEntry(paneId)?.term;
  if (!term) throw new Error(`no terminal pane ${paneId}`);
  const buf = term.buffer.active;
  const end = Math.min(buf.length, buf.baseY + term.rows);
  const out: string[] = [];
  for (let i = Math.max(0, end - lines); i < end; i++) out.push(buf.getLine(i)?.translateToString(true) ?? "");
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join("\n");
}

async function sendToPane(from: string, paneId: string, text: string): Promise<string> {
  const pane = useLayout.getState().panes[paneId];
  if (!pane || pane.browser || pane.editor || pane.launcher) throw new Error(`no terminal pane ${paneId}`);
  if (paneId === from) throw new Error("that is your own pane");
  if (!text.trim()) throw new Error("text is empty");
  if (pane.mode === "chat") {
    const chat = useChat.getState().byPane[paneId];
    if (chat?.approvals.length) throw new Error("that pane is waiting on its human; try again after they answer");
    if (chat?.status === "exited") throw new Error("that chat has stopped");
    const busy = chat?.status === "working" || chat?.status === "waiting";
    await sendChat(paneId, text.trim());
    return busy ? "queued: it goes in when that agent finishes its turn" : "sent";
  }
  const s = useAgents.getState().sessions[paneId];
  // A permission prompt or question is for the human: typing into it could answer it.
  if (s?.status === "needs_input") throw new Error("that pane is waiting on its human; try again after they answer");
  if (s && (s.status === "working" || s.status === "starting")) {
    enqueue(paneId, text);
    return "queued: it goes in when that agent finishes its turn";
  }
  const { sent } = s ? await sendPrompt(paneId, text) : { sent: submitToPane(paneId, text) };
  if (!sent) throw new Error("that pane isn't running");
  return "sent";
}

function openPane(from: string, params: Record<string, unknown>): string {
  const layout = useLayout.getState();
  const caller = layout.panes[from];
  const accounts = useConfig.getState().config?.accounts.map((a) => a.name) ?? [];
  const account = accounts.includes(str(params.account)) ? str(params.account) : (caller?.account ?? useAgents.getState().sessions[from]?.account);
  const cwd = str(params.cwd) ? expandPath(str(params.cwd)) : (useAgents.getState().sessions[from]?.cwd ?? caller?.cwd);
  const prompt = str(params.prompt).trim();
  if (!prompt) throw new Error("prompt is required");
  // `view` from the MCP tool; unset follows the agent picker's "Open as chat".
  const chat = params.mode === "chat" || params.view === "chat" || (params.view !== "terminal" && params.mode !== "terminal" && useUi.getState().claudeAsChat);
  const opts = { account: account || undefined, cwd, mode: chat ? ("chat" as const) : undefined };
  const id = caller ? layout.splitPane(from, "row", opts) : layout.newTab(opts);
  if (chat) queueFirstMessage(id, prompt);
  else queueInit(id, `claude ${shellQuote(prompt)}`);
  return id;
}

/** The browser pane an agent means: the one it names, else the one in its tab, else the only one. */
export function browserPaneFor(from: string, named: string): string {
  const layout = useLayout.getState();
  const isBrowser = (id: string) => !!layout.panes[id]?.browser;
  if (named) {
    if (!isBrowser(named)) throw new Error(`no browser pane ${named}`);
    return named;
  }
  const tab = layout.tabs.find((t) => paneIds(t.root).includes(from));
  const mine = tab && paneIds(tab.root).find(isBrowser);
  if (mine) return mine;
  const all = Object.keys(layout.panes).filter(isBrowser);
  if (all.length === 1) return all[0];
  throw new Error(all.length ? `several browser panes (${all.join(", ")}); pass pane` : "no browser pane; call action open with a url first");
}

/** `aurelia_browser`: the pane is picked here; the page work runs in Rust (browser_agent.rs). */
async function browser(from: string, p: Record<string, unknown>): Promise<unknown> {
  const action = str(p.action);
  const { action: _, pane: __, ...args } = p;
  let pane: string;
  if (action === "open") {
    const url = str(p.url);
    if (!url) throw new Error("open needs a url");
    pane = str(p.pane) ? browserPaneFor(from, str(p.pane)) : openInBrowserPane(useLayout.getState().panes[from] ? from : undefined, url);
    if (str(p.pane)) useLayout.getState().updatePane(pane, { browser: { url } });
  } else pane = browserPaneFor(from, str(p.pane));
  // The page this pane was last sent to: a navigation the agent just caused (show_html, a
  // link) may not have started yet, and Rust waits for it before acting.
  const expect = useLayout.getState().panes[pane]?.browser?.url;
  return invoke("browser_agent", { pane, action, args: { ...args, ...(expect && action !== "open" ? { expect } : {}) } });
}

async function answer(req: Request): Promise<unknown> {
  const p = req.params ?? {};
  switch (req.method) {
    case "list_panes":
      return listPanes(req.from);
    case "read_pane":
      return readPane(str(p.pane), Math.min(400, Math.max(5, Number(p.lines) || 80)));
    case "send_to_pane":
      return sendToPane(req.from, str(p.pane), str(p.text));
    case "open_pane":
      return { pane: openPane(req.from, p) };
    case "open_url":
      return { pane: openInBrowserPane(useLayout.getState().panes[req.from] ? req.from : undefined, str(p.url)), url: str(p.url) };
    case "task_add":
      return { task: await taskAdd(req.from, p) };
    case "task_list":
      return taskList(p);
    case "task_update":
      return { task: taskUpdate(p) };
    case "team_status":
      return teamStatus(p);
    case "team_finish":
      return teamFinish(p, req.from);
    case "browser":
      return browser(req.from, p);
    default:
      throw new Error(`unknown method ${req.method}`);
  }
}

export async function startControl() {
  await listen<Request>("control-request", async (e) => {
    const req = e.payload;
    let reply: unknown;
    try {
      reply = { result: await answer(req) };
    } catch (err) {
      reply = { error: err instanceof Error ? err.message : String(err) };
    }
    invoke("control_reply", { id: req.id, reply }).catch(() => {});
  });
}
