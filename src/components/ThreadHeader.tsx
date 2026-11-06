import { useMemo } from "react";
import { basename } from "../lib/format";
import { isOpenCode, useChat } from "../lib/chat";
import { chatIcon } from "../lib/threadOrder";
import { freshChat } from "../lib/chatStart";
import { ipc } from "../lib/ipc";
import { useAgents } from "../store/agents";
import { paneDir, useGit } from "../store/git";
import { paneIds, useLayout } from "../store/layout";
import { usePrs } from "../store/prs";
import { useUi } from "../store/ui";
import { crewRuns } from "../lib/crew";
import { familyOf } from "../lib/threadFamily";
import { locationTitle } from "../lib/threadTools";
import { tasksForPane, useTasks } from "../store/tasks";
import { usePaneAgent } from "./AgentChip";
import { BranchIcon, GridIcon, PrIcon, SparkIcon, RightPanelIcon, WorktreeIcon } from "./Icons";
import { AccountSwitch } from "./AccountSwitch";
import { ModeChip, PaneMenu } from "./PaneHeader";
import { ChatUsageChip } from "./UsageChip";
import { useChatTitle } from "./ProjectsSidebar";
import { StatusGlyph, visualOf } from "./StatusGlyph";

/** "AureliaSpace" → "AS", "mtr-addon" → "MA", "web" → "WE". */
export function repoBadge(name: string) {
  const caps = name.match(/[A-Z]/g);
  if (caps && caps.length >= 2) return caps.slice(0, 2).join("");
  const words = name.split(/[-_ .]+/).filter(Boolean);
  return (words.length >= 2 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

/**
 * Above the stage: where you are (repo / thread, its branch and PR) and the three views of it:
 * Colony (every thread of the tab at once), a shell below it, and its changes on the right.
 */
export function ThreadHeader() {
  const single = useUi((s) => s.single);
  const gridFolded = useUi((s) => s.gridFolded);
  // The composer's picker shows a chat's permission mode; this repeats it in the header (Settings → Threads & keys).
  const headerMode = useUi((s) => s.prefs.headerModeChip);
  const board = useUi((s) => s.mode === "agents");
  const work = useUi((s) => s.mode === "work");
  const full = board || work;
  const railOpen = useUi((s) => s.agentPanelOpen && s.railTab === "changes");
  const tab = useLayout((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const paneId = tab?.focusedPaneId;
  const tabRoot = tab?.root;
  const pane = useLayout((s) => (paneId ? s.panes[paneId] : undefined));
  const sessions = useAgents((s) => s.sessions);
  const dir = paneId ? paneDir(paneId) : undefined;
  const git = useGit((s) => (dir ? s.info[dir] : undefined));
  const pr = usePrs((s) => (dir ? s.byDir[dir] : undefined));
  const title = useChatTitle(paneId ?? "");
  const taskTitle = useTasks((s) => {
    if (!paneId) return undefined;
    const attached = tasksForPane(s.projects, paneId);
    return (attached.find((t) => t.status === "doing") ?? attached[0])?.title;
  });
  const chatStatus = useChat((s) => (paneId ? s.byPane[paneId]?.status : undefined));
  const approvals = useChat((s) => (paneId ? (s.byPane[paneId]?.approvals.length ?? 0) : 0));
  const custom = usePaneAgent(paneId ?? "");
  const chatItems = useChat((s) => (paneId ? s.byPane[paneId]?.transcript.items : undefined));
  const crew = useMemo(() => crewRuns(chatItems ?? []).length, [chatItems]);
  const kids = useLayout((s) => (paneId ? familyOf(s.panes, paneId).children.length : 0));
  const ui = useUi.getState();

  const tools = (
    <div className="th-tools">
      <button className="ib labelled" title="Grid: every thread of this tab at once" aria-label="Grid" aria-pressed={!single || full} onClick={() => ui.set(full ? { mode: "terminals" } : { single: !single })}>
        <GridIcon />
        <span>Grid</span>
      </button>
      <button
        className="ib labelled"
        title="This thread's changes (⌘B)"
        aria-label="Changes"
        aria-pressed={railOpen}
        onClick={() => ui.set(railOpen ? { agentPanelOpen: false } : { agentPanelOpen: true, railTab: "changes" })}
      >
        <RightPanelIcon />
        <span>Changes</span>
      </button>
    </div>
  );

  if (board)
    return (
      <div className="thread-head">
        <div className="crumb">
          <h1>Board</h1>
          <span>· every agent, by what it needs</span>
        </div>
        <span className="sp" />
        {tools}
      </div>
    );

  if (work)
    return (
      <div className="thread-head">
        <div className="crumb">
          <h1>Board</h1>
          <span>· every unit of work, across projects</span>
        </div>
        <span className="sp" />
        {tools}
      </div>
    );

  if (!single) {
    const ids = tabRoot ? paneIds(tabRoot) : [];
    const working = ids.filter((id) => sessions[id]?.status === "working").length;
    return (
      <div className="thread-head">
        <div className="crumb">
          <h1 className="fixed">All threads</h1>
          {gridFolded ? (
            <span className="num" title={`Too narrow for ${ids.length} threads side by side${working ? ` (${working} working)` : ""}. Close the side panel or widen the window to see the grid.`}>
              · 1 of {ids.length} shown
            </span>
          ) : (
            <span className="num">
              · {ids.length} {ids.length === 1 ? "thread" : "threads"} in this tab
              {working ? `, ${working} working` : ""}
            </span>
          )}
        </div>
        <span className="sp" />
        {tools}
      </div>
    );
  }

  const repo = basename(git?.repo ?? dir) || "~";
  const agent = paneId ? sessions[paneId] : undefined;
  const account = pane?.account ?? agent?.account;
  const chat = pane?.mode === "chat";
  // PaneView drops the pane header for these, so its tools live here.
  const bare = (chat || !!pane?.launcher) && tabRoot?.type !== "split";
  const name = locationTitle({
    paneTitle: pane?.title,
    chatTitle: title,
    taskTitle,
    fresh: freshChat(pane, chatItems?.length ?? 0),
    launcher: !!pane?.launcher,
    browser: !!pane?.browser,
    editorName: pane?.editor ? basename(pane.editor.path) : undefined,
    customName: custom?.name,
    openCode: isOpenCode(pane),
    namedAgent: !!(pane?.account || agent),
  });
  const prTone = pr && (pr.state === "MERGED" ? "merged" : pr.conflicts || pr.checks === "fail" ? "bad" : pr.checks === "pass" ? "ok" : "");
  const prWhat = pr && (pr.state !== "OPEN" ? pr.state.toLowerCase() : pr.conflicts ? "conflicts" : pr.checks === "none" ? (pr.draft ? "draft" : "open") : `checks ${pr.checks}`);

  return (
    <div className="thread-head">
      <div className="crumb" title={dir}>
        {chat && <StatusGlyph state={agent ? visualOf(agent) : chatIcon(chatStatus, approvals)} />}
        <span className="mono-badge">{repoBadge(repo)}</span>
        <span className="crumb-repo">{repo}</span>
        <span className="crumb-sep" aria-hidden="true">/</span>
        <h1 title={name}>{name}</h1>
      </div>
      {crew + kids > 0 && (
        <button className="chip crew-chip" title="Agents this thread delegated to: open the crew in the sidebar" onClick={() => ui.set({ nav: "projects" })}>
          <SparkIcon width={13} height={13} />
          {crew + kids} crew
        </button>
      )}
      {chat && account && paneId && headerMode && <AccountSwitch paneId={paneId} account={account} />}
      {git && headerMode && (
        <span className={`chip${git.worktree ? " wt" : ""}`} title={`${git.detached ? "Detached HEAD" : "Branch"} ${git.branch}${git.worktree ? `\nWorktree: ${git.root}` : ""}`}>
          {git.worktree ? <WorktreeIcon width={13} height={13} /> : <BranchIcon width={13} height={13} />}
          {git.branch}
        </span>
      )}
      {chat && paneId && !isOpenCode(pane) && headerMode && <ModeChip paneId={paneId} />}
      {chat && paneId && headerMode && <ChatUsageChip paneId={paneId} />}
      {pr && (
        <button className={`chip pr ${prTone}`} title={`PR #${pr.number}: ${pr.title}\nClick to open on GitHub`} onClick={() => void ipc.openUrl(pr.url)}>
          <PrIcon width={13} height={13} />#{pr.number} {prWhat}
        </button>
      )}
      <span className="sp" />
      {bare && paneId && (
        <span className="th-pane">
          <PaneMenu paneId={paneId} />
        </span>
      )}
      {tools}
    </div>
  );
}
