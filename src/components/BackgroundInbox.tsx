import { useMemo } from "react";
import { useChat } from "../lib/chat";
import { delegationTool } from "../lib/delegation";
import { ago } from "../lib/format";
import { inboxItems, type InboxInput, type InboxItem } from "../lib/inbox";
import { useRoutineRuns } from "../lib/routines";
import { showPane } from "../lib/terminals";
import { useAgents } from "../store/agents";
import { useConfig } from "../store/config";
import { useLayout } from "../store/layout";
import { useNightly } from "../store/nightly";
import { usePrs } from "../store/prs";
import { useTeamRuns } from "../store/teamRuns";

/** A chat waiting on an approval needs you, like a terminal agent at a prompt. */
const paneStatus = (chat?: string, agent?: string) => (chat === "waiting" ? "needs_input" : (chat ?? agent ?? "idle"));

const LABEL: Record<InboxItem["state"], string> = { waiting: "Needs you", running: "Running", failed: "Failed", done: "Done" };

/**
 * Alerts → Inbox: the work running without you, read from the stores that already hold it. Mounted only while
 * the popover is open, so nothing here runs in the background.
 */
export function BackgroundInbox({ onOpen }: { onOpen(): void }) {
  const chats = useChat((s) => s.byPane);
  const runs = useRoutineRuns((s) => s.runs);
  const routines = useConfig((s) => s.config?.routines);
  const sessions = useAgents((s) => s.sessions);
  const nightly = useNightly();
  const panes = useLayout((s) => s.panes);
  const prs = usePrs((s) => s.byDir);
  const teams = useTeamRuns((s) => s.runs);

  const items = useMemo(() => {
    const input: InboxInput = {
      chats: Object.entries(chats).map(([paneId, c]) => ({
        paneId,
        tools: c.transcript.items.flatMap((i) => (i.kind === "tool" && delegationTool(i.name) ? [{ id: i.id, name: i.name, input: i.input, result: i.result, isError: i.isError, at: i.at }] : [])),
      })),
      routines: Object.entries(runs).map(([id, r]) => ({
        id,
        name: routines?.find((x) => x.id === id)?.name ?? "",
        at: r.at,
        paneId: r.paneId,
        status: panes[r.paneId] ? paneStatus(chats[r.paneId]?.status, sessions[r.paneId]?.status) : undefined,
      })),
      nightly: { running: nightly.running, byRepo: nightly.byRepo },
      babysits: Object.entries(panes)
        .filter(([, p]) => p.babysit || (p.babysitWakes ?? 0) > 0)
        .map(([paneId, p]) => ({ paneId, title: p.title ?? "Thread", on: !!p.babysit, wakes: p.babysitWakes ?? 0, pr: p.cwd ? prs[p.cwd] : null, at: 0 })),
      teams,
    };
    return inboxItems(input);
  }, [chats, runs, routines, sessions, nightly, panes, prs, teams]);

  if (!items.length) return <p className="empty">Nothing in the background. Delegated agents, routines, the nightly review, PR babysits and team runs show up here.</p>;
  return (
    <div className="inbox-list" role="list">
      {items.map((it) => {
        const canOpen = !!it.paneId && !!panes[it.paneId];
        return (
          <button
            key={it.key}
            role="listitem"
            className={`notice-row live inbox-row ${it.state}`}
            disabled={!canOpen}
            title={canOpen ? "Open its thread" : undefined}
            onClick={() => {
              if (!canOpen) return;
              showPane(it.paneId!);
              onOpen();
            }}
          >
            <span className={`inbox-dot ${it.state}`} aria-label={LABEL[it.state]} />
            <span className="notice-row-main">
              <span className="notice-row-title">{it.title}</span>
              <span className="notice-row-body">{it.result}</span>
            </span>
            <span className="notice-ago">{it.at > 0 ? ago(it.at) : LABEL[it.state]}</span>
          </button>
        );
      })}
    </div>
  );
}
