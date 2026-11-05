/**
 * The background inbox (Grok's mockup D, 2026-11-05): one list of the work running without you, read from the
 * stores that already hold it: delegations from chat tool calls, routines, the nightly review, PR babysits and
 * team runs. Nothing here polls; the Alerts popover builds the input while it is open. Pure, for `node --test`.
 */
import { parseDelegation } from "./delegation.ts";

export type InboxState = "waiting" | "running" | "failed" | "done";
export type InboxKind = "delegation" | "routine" | "nightly" | "babysit" | "team";

export interface InboxItem {
  key: string;
  kind: InboxKind;
  title: string;
  state: InboxState;
  /** One line: the report, the error, or where it stands. */
  result: string;
  at: number;
  /** The thread to open, when it is still there. */
  paneId?: string;
}

export interface InboxInput {
  chats: { paneId: string; tools: { id: string; name: string; input: Record<string, unknown>; result?: string; isError?: boolean; at?: number }[] }[];
  /** Routines that ran this session, with the agent status of the pane each one opened (undefined: closed). */
  routines: { id: string; name: string; at: number; paneId?: string; status?: string }[];
  nightly: { running: boolean; byRepo: Record<string, { folder: string; at: number; error?: string; findings: unknown[] }> };
  babysits: { paneId: string; title: string; on: boolean; wakes: number; pr?: { number: number; state: string; checks: string } | null; at: number }[];
  teams: { id: string; task: string; status: "running" | "done" | "blocked" | "failed"; summary: string; createdAt: number; paneIds: string[] }[];
}

const RANK: Record<InboxState, number> = { waiting: 0, running: 1, failed: 2, done: 3 };
const firstLine = (s: string | undefined) => (s ?? "").trim().split("\n")[0].trim();
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const base = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;

function delegations(input: InboxInput): InboxItem[] {
  // A run started in the background and checked later is one row: the later call has the id, not the task.
  const runs = new Map<string, { task: string; who: string; item: InboxItem }>();
  for (const chat of input.chats) {
    for (const t of chat.tools) {
      const d = parseDelegation(t.name, t.input, t.result, t.isError);
      // A check on all runs (no id) says nothing about one of them.
      if (!d || (d.tool === "delegation" && !d.id)) continue;
      const key = `deleg:${chat.paneId}:${d.id ?? t.id}`;
      const prev = runs.get(key);
      const task = firstLine(d.task) || prev?.task || "a task";
      const who = d.who ?? prev?.who ?? "Agent";
      const state: InboxState = d.state === "done" ? "done" : d.state === "failed" ? "failed" : "running";
      const result =
        state === "done"
          ? firstLine(d.report) || (d.changed.length ? `Changed ${plural(d.changed.length, "file")}` : "Done")
          : state === "failed"
            ? firstLine(d.stopped ?? d.report) || "Failed"
            : (d.state === "status" && firstLine(d.report)) || "Working";
      runs.set(key, { task, who, item: { key, kind: "delegation", title: `${who}: ${task}`, state, result, at: t.at ?? prev?.item.at ?? 0, paneId: chat.paneId } });
    }
  }
  return [...runs.values()].map((r) => r.item);
}

function routines(input: InboxInput): InboxItem[] {
  return input.routines.map((r) => {
    const state: InboxState = r.status === "needs_input" ? "waiting" : r.status === "working" || r.status === "starting" ? "running" : "done";
    const result = state === "waiting" ? "Needs your answer" : state === "running" ? "Working in its thread" : r.paneId ? "Finished; its thread is open" : "Finished";
    return { key: `routine:${r.id}`, kind: "routine", title: `Routine: ${r.name.trim() || "untitled"}`, state, result, at: r.at, paneId: r.status === undefined ? undefined : r.paneId };
  });
}

function nightly(input: InboxInput): InboxItem[] {
  const out: InboxItem[] = [];
  if (input.nightly.running) out.push({ key: "nightly:now", kind: "nightly", title: "Nightly review", state: "running", result: "Reading one folder of each open repo", at: 0 });
  for (const [repo, n] of Object.entries(input.nightly.byRepo)) {
    const found = n.findings.length;
    out.push({
      key: `nightly:${repo}`,
      kind: "nightly",
      title: `Nightly review: ${base(repo)}`,
      state: n.error ? "failed" : "done",
      result: n.error ?? (found ? `${plural(found, "finding")} in ${n.folder}` : `Nothing found in ${n.folder}`),
      at: n.at,
    });
  }
  return out;
}

function babysits(input: InboxInput): InboxItem[] {
  return input.babysits
    .filter((b) => b.on || b.wakes > 0)
    .map((b) => {
      const merged = b.pr?.state === "MERGED";
      const state: InboxState = b.on ? "running" : merged ? "done" : "waiting";
      const checks = b.pr && b.pr.checks !== "none" ? (b.pr.checks === "fail" ? "checks failing" : `checks ${b.pr.checks}`) : "";
      const result = merged ? "Merged" : [b.on ? `Woken ${plural(b.wakes, "time")}` : `Stopped after ${plural(b.wakes, "wake")}`, checks].filter(Boolean).join("; ");
      return { key: `babysit:${b.paneId}`, kind: "babysit", title: b.pr ? `PR #${b.pr.number}: ${b.title}` : `PR: ${b.title}`, state, result, at: b.at, paneId: b.paneId };
    });
}

function teams(input: InboxInput): InboxItem[] {
  return input.teams.map((t) => ({
    key: `team:${t.id}`,
    kind: "team",
    title: `Team: ${firstLine(t.task) || "untitled"}`,
    state: t.status === "blocked" ? "waiting" : t.status,
    result: firstLine(t.summary) || (t.status === "running" ? "Working" : t.status === "failed" ? "Failed" : "Done"),
    at: t.createdAt,
    paneId: t.paneIds[0],
  }));
}

/**
 * Everything in the background, what needs you first, then what's running, failed and done; newest first in each.
 * Rows with no time (`at: 0`, PR babysits: a pane doesn't record when it started) keep their order at the end of their group.
 */
export function inboxItems(input: InboxInput): InboxItem[] {
  return [...delegations(input), ...routines(input), ...nightly(input), ...babysits(input), ...teams(input)].sort((a, b) => RANK[a.state] - RANK[b.state] || b.at - a.at);
}
