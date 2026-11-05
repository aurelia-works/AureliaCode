import { basename, formatCost, formatTokens } from "../lib/format";
import { useChat } from "../lib/chat";
import type { DiffStat as DiffStatData } from "../lib/ipc";
import { chatIcon } from "../lib/threadOrder";
import { liveToolLabel } from "../lib/toolPhrase";
import { useAgents } from "../store/agents";
import { useGit } from "../store/git";
import { useLayout } from "../store/layout";
import { tasksForPane, useTasks } from "../store/tasks";
import { useUi } from "../store/ui";
import { since } from "./SessionExtras";
import { StatusGlyph, visualOf, type Visual } from "./StatusGlyph";

/** `+42 −7 · 3 files`: what a thread has changed against HEAD, in tabular mono like T3's DiffStatLabel. */
export function DiffStat({ stat, files = true }: { stat: DiffStatData | null | undefined; files?: boolean }) {
  if (!stat || !stat.files) return null;
  return (
    <span className="diffstat num" role="group" aria-label={`${stat.additions} lines added, ${stat.deletions} removed, ${stat.files} ${stat.files === 1 ? "file" : "files"} changed`}>
      <span className="add" aria-hidden>
        +{stat.additions}
      </span>
      <span className="del" aria-hidden>
        −{stat.deletions}
      </span>
      {files && (
        <span className="files" aria-hidden>
          {stat.files} {stat.files === 1 ? "file" : "files"}
        </span>
      )}
    </span>
  );
}

export interface ThreadSummary {
  v: Visual;
  /** The thread's name: its title, else its attached task, else its folder. */
  title: string;
  /** What it is doing or waiting on, in words ("Editing keys.ts", the question it asked). */
  detail: string;
  folder: string;
  branch?: string;
  stat?: DiffStatData | null;
  /** Since the last state change, "3m"; undefined without a hook session. */
  age?: string;
  /** "$0.84 · 412k tokens" so far, for chats; undefined when nothing was spent or the switch is off. */
  cost?: string;
}

/** Everything a thread row or card says about a thread, from one place, so the grid, the board and the list agree. */
export function useThreadSummary(paneId: string, cwd?: string): ThreadSummary {
  const agent = useAgents((s) => s.sessions[paneId]);
  const chat = useChat((s) => s.byPane[paneId]?.status);
  const approvals = useChat((s) => s.byPane[paneId]?.approvals.length ?? 0);
  const paneTitle = useLayout((s) => s.panes[paneId]?.title);
  const paneCwd = useLayout((s) => s.panes[paneId]?.cwd);
  const task = useTasks((s) => tasksForPane(s.projects, paneId)[0]?.title);
  const dir = agent?.cwd ?? cwd ?? paneCwd;
  const branch = useGit((s) => (dir ? s.info[dir]?.branch : undefined));
  const stat = useGit((s) => (dir ? s.stat[dir] : undefined));
  const usd = useLayout((s) => s.panes[paneId]?.chatCost ?? 0);
  const tokens = useLayout((s) => s.panes[paneId]?.chatTokens ?? 0);
  const costOn = useUi((s) => s.prefs.threadCost);

  const v: Visual = agent ? visualOf(agent) : chatIcon(chat, approvals);
  const folder = basename(dir) || "this folder";
  const named = paneTitle ?? task;
  const detail =
    v === "needs_input"
      ? (agent?.message ?? "Claude is waiting for your answer.")
      : v === "working"
        ? agent?.tool
          ? liveToolLabel({ name: agent.tool, input: (agent.toolInput ?? {}) as Record<string, unknown> }, paneId)
          : "Thinking"
        : v === "done"
          ? "Done. Read the result and reply."
          : v === "starting"
            ? "Starting Claude…"
            : named
              ? `Not started. Type below to start it in ${folder}.`
              : `No task yet. Type one below to start in ${folder}.`;
  return {
    v,
    title: named ?? (v === "idle" ? "New thread" : folder),
    detail,
    folder,
    branch,
    // The stat is per folder: an unstarted thread sharing one would just repeat its neighbour's numbers.
    stat: v === "idle" ? undefined : stat,
    age: agent ? since(Date.now() - agent.updatedAt) : undefined,
    cost: costOn && tokens > 0 ? `${formatCost(usd)} · ${formatTokens(tokens)} tokens` : undefined,
  };
}

/** The top line every thread card shares: state icon and word, then how long ago. */
export function ThreadCardHead({ t, children }: { t: ThreadSummary; children?: React.ReactNode }) {
  return (
    <div className="tc-head">
      <StatusGlyph state={t.v} word />
      {t.age && <span className="tc-age num">{t.age === "now" ? "now" : `${t.age} ago`}</span>}
      {children}
    </div>
  );
}

/** The bottom line every thread card shares: folder, branch and what changed. */
export function ThreadMeta({ t }: { t: ThreadSummary }) {
  return (
    <p className="tc-meta">
      <span>{t.folder}</span>
      {t.branch && <span className="mono tc-branch">{t.branch}</span>}
      <DiffStat stat={t.stat} />
      {t.cost && <span className="num tc-cost" title="What this thread has spent so far">{t.cost}</span>}
    </p>
  );
}
