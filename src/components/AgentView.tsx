import { useEffect, useState } from "react";
import { create } from "zustand";
import { useNow } from "../lib/cache";
import { basename, shortenPath } from "../lib/format";
import { runTeam } from "../lib/runTeam";
import { showPane } from "../lib/terminals";
import { useAgents, type AgentSession } from "../store/agents";
import { useCustomAgents, type AgentTeam } from "../store/customAgents";
import { paneIds, useLayout } from "../store/layout";
import { useTeamRuns, type TeamRun } from "../store/teamRuns";
import { toast } from "../store/ui";
import { AgentChip } from "./AgentChip";
import { SparkIcon } from "./Icons";
import { since } from "./SessionExtras";
import { StatusGlyph, stateLabel, urgency, visualOf, type Visual } from "./StatusGlyph";

/**
 * Agent view: every live pane and every team run on one screen. Panes are sorted by who
 * needs you first; a team run keeps its task, plan and merged report after its panes move
 * on. "Run team" starts one without leaving this screen.
 */

/** Open the agent view (and/or its Run team dialog) from the board, the palette or a shortcut. */
export const useAgentViewOpen = create<{ open: boolean; run: boolean }>(() => ({ open: false, run: false }));
export const openAgentView = (run = false) => useAgentViewOpen.setState({ open: true, run });

interface Live {
  id: string;
  tab: number;
  cwd?: string;
  title?: string;
  agentId?: string;
  /** Account, harness or shell: what is doing the work. */
  who: string;
  state: Visual | "shell";
  detail: string;
  updatedAt: number;
}

const STATE_CLASS: Record<Visual | "shell", string> = {
  needs_input: "needs",
  done: "done",
  working: "working",
  starting: "working",
  idle: "idle",
  shell: "idle",
};

function liveAction(session: AgentSession | undefined): string {
  if (!session) return "At the prompt";
  switch (session.status) {
    case "needs_input":
      return session.message || "Needs you";
    case "working":
      return session.tool ? `Running ${session.tool}` : "Thinking…";
    case "starting":
      return "Starting up…";
    case "idle":
      return session.attention ? "Finished. Your turn." : "Idle at the prompt";
  }
}

const stateText = (state: Visual | "shell") => (state === "shell" ? "shell" : stateLabel[state]);

const runStatusText: Record<TeamRun["status"], string> = {
  running: "running",
  done: "done",
  blocked: "blocked",
  failed: "failed",
};

function LiveRow({ item, now }: { item: Live; now: number }) {
  const agent = useCustomAgents((s) => s.agents.find((a) => a.id === item.agentId));
  return (
    <button className={`av-row ${STATE_CLASS[item.state]}`} onClick={() => showPane(item.id)} title={`Open ${shortenPath(item.cwd ?? "")}`}>
      <StatusGlyph state={item.state} />
      <span className="av-main">
        <span className="av-line">
          <span className="av-title">{item.title || basename(item.cwd ?? "") || "~"}</span>
          {agent ? <AgentChip agent={agent} /> : <span className="av-who">{item.who}</span>}
          <span className="av-tab num">T{item.tab + 1}</span>
          <span className="av-ago num">{item.updatedAt ? since(now - item.updatedAt) : "—"}</span>
        </span>
        <span className={`av-detail${item.state === "needs_input" ? "" : " quiet"}`}>{item.detail}</span>
      </span>
      <span className="av-state">{stateText(item.state)}</span>
    </button>
  );
}

function RunRow({ run, team, now, onOpen }: { run: TeamRun; team?: AgentTeam; now: number; onOpen(): void }) {
  const agents = useCustomAgents((s) => s.agents);
  const lead = agents.find((a) => a.id === run.plan.leadId);
  const [open, setOpen] = useState(false);
  return (
    <article className={`av-run ${run.status}`}>
      <header className="av-run-head">
        <span className={`av-run-status ${run.status}`}>{runStatusText[run.status]}</span>
        <button className="av-run-title" onClick={onOpen} title="Open its first pane">
          {run.task}
        </button>
        <span className="av-run-meta num">{since(now - run.createdAt)}</span>
      </header>
      <p className="av-run-plan">
        {team?.name ?? run.teamId} · lead {(lead?.name ?? run.plan.leadId) || "—"}
        {run.plan.workers.length
          ? ` · ${run.plan.workers.length} worker${run.plan.workers.length === 1 ? "" : "s"}: ` +
            run.plan.workers.map((w) => `${w.role}${w.model ? ` (${w.model})` : ""}`).join(", ")
          : " · ran alone"}
      </p>
      <div className="av-run-foot">
        <span className="av-run-panes num">
          {run.paneIds.length} pane{run.paneIds.length === 1 ? "" : "s"}
        </span>
        {run.summary && (
          <button className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Hide report" : "Report"}
          </button>
        )}
        <button className="link-btn" onClick={onOpen} disabled={!run.paneIds.length}>
          Open
        </button>
      </div>
      {open && <pre className="av-run-summary">{run.summary}</pre>}
    </article>
  );
}

function RunTeamDialog({ teams, onClose }: { teams: AgentTeam[]; onClose(): void }) {
  const agents = useCustomAgents((s) => s.agents);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [task, setTask] = useState("");
  const [worktree, setWorktree] = useState(false);
  const [busy, setBusy] = useState(false);
  const team = teams.find((t) => t.id === teamId);
  const members = team ? team.agentIds.map((id) => agents.find((a) => a.id === id)).filter(Boolean) : [];

  const start = async () => {
    if (!team) return;
    if (!task.trim()) {
      toast("Type what the team should do first.", true);
      return;
    }
    setBusy(true);
    try {
      const id = await runTeam(team, task, { worktree });
      if (id) onClose();
    } catch (e) {
      toast(`Couldn't start the team: ${e instanceof Error ? e.message : String(e)}`, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal run-team"
        role="dialog"
        aria-label="Run team"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <div className="modal-head">
          <h2>Run team</h2>
        </div>
        <div className="run-team-body">
          {teams.length === 0 ? (
            <p className="hint">No saved teams yet. Make one in Settings → Agents.</p>
          ) : (
            <>
              <label className="field">
                <span>Team</span>
                <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.agentIds.length} agent{t.agentIds.length === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              </label>
              <div className="run-team-members">
                {members.map((a) => a && <AgentChip key={a.id} agent={a} title={a.name} />)}
                {members.length > 0 && (
                  <span className="hint">
                    {team?.routing ?? "balanced"} routing · {team?.maxConcurrency ?? 4} panes at once
                  </span>
                )}
              </div>
              <label className="field">
                <span>Task</span>
                <textarea
                  rows={4}
                  autoFocus
                  value={task}
                  placeholder="e.g. Ship the settings keyboard fix: tests, implementation, then review the diff"
                  onChange={(e) => setTask(e.target.value)}
                />
              </label>
              <label className="field check">
                <input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} />
                <span>Give each pane its own git worktree</span>
              </label>
            </>
          )}
        </div>
        <div className="modal-foot actions">
          <span className="msg">opens a lead chat and one pane per worker</span>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!teams.length || busy}>
            {busy ? "Starting…" : "Run team"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function AgentView({ onBack }: { onBack?(): void }) {
  const sessions = useAgents((s) => s.sessions);
  const tabs = useLayout((s) => s.tabs);
  const panes = useLayout((s) => s.panes);
  const teams = useCustomAgents((s) => s.teams);
  const runs = useTeamRuns((s) => s.runs);
  const [runOpen, setRunOpen] = useState(false);
  const runWanted = useAgentViewOpen((s) => s.run);
  const now = useNow();

  // The palette's "Run team…" opens this screen and its dialog together.
  useEffect(() => {
    if (!runWanted) return;
    setRunOpen(true);
    useAgentViewOpen.setState({ run: false });
  }, [runWanted]);

  const live: Live[] = tabs
    .flatMap((tab, i): Live[] =>
      paneIds(tab.root).flatMap((id): Live[] => {
        const pane = panes[id];
        if (!pane || pane.launcher || pane.browser || pane.editor) return [];
        const session = sessions[id];
        const state = session ? visualOf(session) : "shell";
        return [
          {
            id,
            tab: i,
            cwd: session?.cwd ?? pane.cwd,
            title: pane.title,
            agentId: pane.customAgent,
            who: session?.account ?? pane.account ?? (pane.mode === "chat" ? "claude" : pane.agent ? pane.agent.split(":")[0] : "shell"),
            state,
            detail: liveAction(session),
            updatedAt: session?.updatedAt ?? 0,
          },
        ];
      }),
    )
    .sort((a, b) => urgencyOf(a.state) - urgencyOf(b.state) || a.updatedAt - b.updatedAt);

  const needs = live.filter((l) => l.state === "needs_input").length;
  const running = live.filter((l) => l.state === "working" || l.state === "starting").length;

  const openRun = (run: TeamRun) => {
    const pane = run.paneIds.find((id) => panes[id]);
    if (pane) showPane(pane);
    else toast("That run's panes are closed.", true);
  };

  return (
    <div className="agent-view" role="region" aria-label="Agent view">
      <header className="av-head">
        <div className="board-title">
          <h1>Agents</h1>
          <span className="board-sub">
            {live.length} live · {needs} need you · {running} working · {runs.length} team run{runs.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="board-actions">
          {onBack && (
            <button className="btn" onClick={onBack} title="Back to the fleet board">
              Fleet
            </button>
          )}
          <button className="btn primary" onClick={() => setRunOpen(true)} disabled={!teams.length} title="Start a team run (⌘P)">
            <SparkIcon width={12} height={12} /> Run team
          </button>
        </div>
      </header>

      <div className="av-scroll">
        <section className="av-section" aria-label="Live panes">
          <h2 className="av-section-head">
            <span>Live</span>
            <span className="lane-count num">{live.length}</span>
          </h2>
          {live.length === 0 ? (
            <p className="empty">No live panes. Open one from the start screen (⌘T).</p>
          ) : (
            <div className="av-rows">
              {live.map((item) => (
                <LiveRow key={item.id} item={item} now={now} />
              ))}
            </div>
          )}
        </section>

        <section className="av-section" aria-label="Team runs">
          <h2 className="av-section-head">
            <span>Team runs</span>
            <span className="lane-count num">{runs.length}</span>
          </h2>
          {runs.length === 0 ? (
            <p className="empty">
              No team runs yet. <button className="link-btn" onClick={() => setRunOpen(true)}>Run a team</button> to give a lead a task and
              hand each worker a slice.
            </p>
          ) : (
            <div className="av-runs">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} team={teams.find((t) => t.id === run.teamId)} now={now} onOpen={() => openRun(run)} />
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="board-keys" aria-hidden>
        <span>click a pane to open it</span>
        <span>
          <kbd>⌘P</kbd> palette → Run team
        </span>
      </footer>

      {runOpen && <RunTeamDialog teams={teams} onClose={() => setRunOpen(false)} />}
    </div>
  );
}

function urgencyOf(state: Visual | "shell"): number {
  return state === "shell" ? 5 : urgency[state];
}
