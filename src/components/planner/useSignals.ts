import { useEffect, useMemo, useState } from "react";
import { expandPath } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import { projectForDir } from "../../lib/plannerToday";
import { evaluate, visible, type Signal } from "../../lib/plannerSignals";
import { prAttention } from "../../lib/threads";
import { paneDir } from "../../store/git";
import { useAgents } from "../../store/agents";
import { useLayout } from "../../store/layout";
import { usePlanner } from "../../store/planner";
import { usePrs } from "../../store/prs";

const REFRESH_MS = 5 * 60_000;

/** Signals for the current planner state, git activity and PRs; `all` includes snoozed ones. */
export function useSignals(): { signals: Signal[]; all: Signal[]; waiting: number; ready: boolean } {
  const data = usePlanner((s) => s.data);
  const panes = useLayout((s) => s.panes);
  const prs = usePrs((s) => s.byDir);
  const sessions = useAgents((s) => s.sessions);
  const [lastCommit, setLast] = useState<Record<string, number | null>>({});
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const paths = data.projects.filter((p) => !p.archivedAt && p.localRepoPath).map((p) => `${p.id}\n${p.localRepoPath}`).join("\n\n");
  useEffect(() => {
    if (!data.switches.signals) return;
    if (!paths) setReady(true);
    let alive = true;
    const read = async () => {
      const rows = await Promise.all(
        data.projects.filter((p) => !p.archivedAt && p.localRepoPath).map(async (p) => [p.id, await ipc.gitLastCommit(expandPath(p.localRepoPath!)).catch(() => null)] as const),
      );
      if (alive) {
        setLast(Object.fromEntries(rows));
        setNow(new Date());
        setReady(true);
      }
    };
    void read();
    const t = setInterval(read, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [paths, data.switches.signals]); // eslint-disable-line react-hooks/exhaustive-deps

  const prRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: { projectId: string | null; number: number; url: string; title: string; why: string }[] = [];
    for (const [id, pane] of Object.entries(panes)) {
      if (pane.settled) continue;
      const d = paneDir(id);
      const pr = d ? prs[d] : undefined;
      const why = prAttention(pr, pane.prSeenFeedback);
      if (!pr || !why || seen.has(pr.url)) continue;
      seen.add(pr.url);
      const proj = projectForDir(data.projects, d, expandPath);
      rows.push({ projectId: proj?.id ?? null, number: pr.number, url: pr.url, title: pr.title, why });
    }
    return rows;
  }, [panes, prs, data.projects]);

  const all = useMemo(() => (data.switches.signals ? evaluate({ s: data, now, lastCommit, prs: prRows }) : []), [data, now, lastCommit, prRows]);
  const signals = useMemo(() => visible(all, data.snoozes), [all, data.snoozes]);
  const waiting = Object.keys(panes).filter((id) => sessions[id]?.status === "needs_input").length;
  return { signals, all, waiting, ready };
}
