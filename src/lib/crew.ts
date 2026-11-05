import type { ChatItem } from "./chatModel.ts";
import { delegationTool, parseDelegation } from "./delegation.ts";

/**
 * The agents a lead chat handed work to, read from the `aurelia_delegate` /
 * `aurelia_delegation` / `deepseek_agent` calls already in its transcript. There is no
 * second store to keep in sync: a background start, a later status check and the final
 * report are the same run, matched by the id the tools return.
 */
export type CrewRunState = "running" | "background" | "done" | "failed" | "status";

export interface CrewLogEntry {
  at: number;
  state: CrewRunState;
  text: string;
}

export interface CrewRun {
  /** Stable key: the run's id once known, else the tool call's id. */
  key: string;
  /** The original tool call id, so an open detail sheet survives the key changing to the run id. */
  requestKey?: string;
  id?: string;
  who: string;
  provider?: string;
  model?: string;
  mode: "read" | "work";
  /** The first line of the task, for the row. */
  title?: string;
  task?: string;
  state: CrewRunState;
  /** One line for the row: what it is doing now, or the first line of its report. */
  detail?: string;
  report?: string;
  changed: string[];
  blocked: string[];
  stopped?: string;
  tools?: number;
  secs?: number;
  startedAt?: number;
  updatedAt: number;
  /** Each start/status/report line, oldest first. */
  log: CrewLogEntry[];
}

const TERMINAL: ReadonlySet<CrewRunState> = new Set(["done", "failed"]);

function firstLine(text: string | undefined, max = 110): string | undefined {
  const line = text?.split("\n").find((l) => l.trim());
  if (!line) return undefined;
  const t = line.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * The state field of a status line (delegate.rs `line()`): `<head> · done`, `<head> · failed`,
 * or `<head> · running Ns · N tool calls[ · now: <note>]`, maybe after "Still running after Ns: ".
 * The head holds the task title and the note is free text, so words in them never count.
 */
function stateFromStatus(report: string | undefined, isError: boolean | undefined): CrewRunState {
  if (isError) return "failed";
  const line = report?.split("\n")[0] ?? "";
  if (/^Still running after \d+s: /.test(line) || / · running \d+s · \d+ tool calls(?: · now: .*)?$/.test(line)) return "running";
  const end = line.match(/ · (done|failed)$/);
  return end ? (end[1] as CrewRunState) : "status";
}

function merge(prev: CrewRun | undefined, next: CrewRun): CrewRun {
  if (!prev) return next;
  // A late status check must never downgrade a finished run.
  const state = TERMINAL.has(prev.state) && !TERMINAL.has(next.state) ? prev.state : next.state;
  const seen = new Set<string>();
  const log = [...prev.log, ...(next.log ?? [])].filter((e) => {
    const k = `${e.at}\u0000${e.state}\u0000${e.text}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  return {
    ...prev,
    ...next,
    state,
    log,
    title: next.title ?? prev.title,
    task: next.task ?? prev.task,
    report: next.report ?? prev.report,
    detail: next.detail ?? prev.detail,
    changed: next.changed.length ? next.changed : prev.changed,
    blocked: next.blocked.length ? next.blocked : prev.blocked,
    stopped: next.stopped ?? prev.stopped,
    tools: next.tools ?? prev.tools,
    secs: next.secs ?? prev.secs,
    id: next.id ?? prev.id,
    requestKey: next.requestKey ?? prev.requestKey,
    startedAt: prev.startedAt ?? next.startedAt,
  };
}

/** The sidebar, the header chip and the worker sheet all read the same transcript array: build it once. */
const cache = new WeakMap<ChatItem[], CrewRun[]>();

export function crewRuns(items: ChatItem[]): CrewRun[] {
  const hit = cache.get(items);
  if (hit) return hit;
  const built = buildCrew(items);
  cache.set(items, built);
  return built;
}

function buildCrew(items: ChatItem[]): CrewRun[] {
  const runs = new Map<string, CrewRun>();
  const order: string[] = [];
  /** A waiting call's tool id can become the run id once a background start answers. */
  const aliases = new Map<string, string>();
  const put = (key: string, run: CrewRun) => {
    if (!runs.has(key)) order.push(key);
    runs.set(key, merge(runs.get(key), run));
  };
  const move = (from: string, to: string) => {
    const run = runs.get(from);
    if (!run) return;
    runs.delete(from);
    const at = order.indexOf(from);
    if (at >= 0) order.splice(at, 1);
    put(to, { ...run, key: to });
    aliases.set(from, to);
  };

  for (const item of items) {
    if (item.kind !== "tool") continue;
    const tool = delegationTool(item.name);
    if (!tool) continue;
    const d = parseDelegation(item.name, item.input, item.result, item.isError);
    if (!d) continue;
    const at = item.at ?? Date.now();
    const inputId = typeof item.input.id === "string" ? item.input.id : undefined;

    if (tool === "delegation") {
      const named = inputId ?? d.id;
      const key = named ? (runs.has(named) ? named : aliases.get(named)) : undefined;
      if (!key) continue; // a status for runs this chat did not start
      const prev = runs.get(key);
      if (!prev) continue;
      // A finished report carries its own verdict; a plain progress line names its state in words.
      const state = d.state === "done" || d.state === "failed" ? d.state : stateFromStatus(d.report, item.isError);
      put(key, {
        ...prev,
        state,
        report: d.report ?? prev.report,
        detail: d.report ? firstLine(d.report) : prev.detail,
        changed: d.changed,
        blocked: d.blocked,
        stopped: d.stopped ?? prev.stopped,
        tools: d.tools ?? prev.tools,
        secs: d.secs ?? prev.secs,
        updatedAt: at,
        log: d.report ? [{ at, state, text: firstLine(d.report) ?? state }] : [],
      });
      continue;
    }

    const requestId = item.id;
    const known = (d.id && (runs.has(d.id) ? d.id : aliases.get(d.id))) || aliases.get(requestId);
    const key = known ?? requestId;
    const prev = runs.get(key);
    const detail = d.report ? firstLine(d.report) : d.state === "running" ? "Starting…" : undefined;
    put(key, {
      key,
      requestKey: requestId,
      id: d.id ?? prev?.id,
      who: d.who ?? (d.provider ? d.provider[0].toUpperCase() + d.provider.slice(1) : "Agent"),
      provider: d.provider,
      model: d.model,
      mode: d.mode,
      title: firstLine(d.task),
      task: d.task,
      state: d.state,
      detail,
      report: d.report,
      changed: d.changed,
      blocked: d.blocked,
      stopped: d.stopped,
      tools: d.tools,
      secs: d.secs,
      startedAt: at,
      updatedAt: at,
      log: [{ at, state: d.state, text: detail ?? "Started" }],
    });
    if (d.id && key !== d.id) move(key, d.id);
    if (d.id) aliases.set(requestId, d.id);
  }

  return order.map((key) => runs.get(key)).filter((r): r is CrewRun => !!r);
}

/** Active runs first, then finished ones; newest first inside each group. */
export function sortCrew(runs: CrewRun[]): CrewRun[] {
  const rank = (r: CrewRun) => (r.state === "running" || r.state === "background" ? 0 : r.state === "status" ? 1 : 2);
  return [...runs].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
}
