import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useChat } from "../lib/chat";
import { basename } from "../lib/format";
import { closePaneSafely, closePanesSafely } from "../lib/openFile";
import { patchThreads } from "../lib/threadActions";
import { dropPlan, pinKeyBefore, zoneOf, type Zone } from "../lib/threadDrop";
import { copyText } from "../lib/copyText";
import { prNumberRef, retitle } from "../lib/threadTools";
import { cleanTitle, pinPatch, settlePatch, splitPinned, stepFocus } from "../lib/threadOrder";
import { showPane } from "../lib/terminals";
import { useAgents } from "../store/agents";
import { paneDir, useGit } from "../store/git";
import { paneIds, useLayout, type PaneMeta } from "../store/layout";
import { usePrs } from "../store/prs";
import { useRuntime } from "../store/runtime";
import { tasksForPane, useTasks } from "../store/tasks";
import { ipc, type PrInfo, type WorktreeEntry } from "../lib/ipc";
import { matchesFilter, prAttention, snoozeChoices } from "../lib/threads";
import { toast, useUi } from "../store/ui";
import { useRemote } from "../lib/remote";
import { usePaneAgent } from "./AgentChip";
import { stateLabel, visualOf, type Visual } from "./StatusGlyph";
import { FolderIcon, GearIcon, GlobeIcon, JellyIcon, LogIcon, PhoneIcon, PlusIcon, PrIcon, SearchIcon, TerminalIcon } from "./Icons";


const clock = (at: number) => {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
};

/** Closes every pane working inside `root`, then removes that worktree. Checks for uncommitted work first. */
export async function cleanUpWorktree(root: string) {
  const entry = (await ipc.listWorktrees(root).catch(() => [] as WorktreeEntry[])).find((w) => w.path === root);
  if (!entry) return toast("Only worktrees AureliaSpace made can be cleaned up.", true);
  if (entry.dirty) return toast(`${basename(root)} has uncommitted changes; left alone.`, true);
  const layout = useLayout.getState();
  for (const id of Object.keys(layout.panes)) {
    const d = paneDir(id);
    if (d && (d === root || d.startsWith(`${root}/`))) layout.closePane(id);
  }
  try {
    await ipc.removeWorktree(root);
    toast(`Removed worktree ${basename(root)}.`);
  } catch (e) {
    toast(String(e), true);
  }
}

/** The snooze choices, plus a custom date and time. */
function SnoozeMenu({ onPick, onClose }: { onPick: (until: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState("");
  useEffect(() => {
    const away = (e: globalThis.MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="snooze-menu" role="menu" onClick={(e) => e.stopPropagation()}>
      {snoozeChoices(new Date()).map((c) => (
        <button key={c.label} role="menuitem" onClick={() => onPick(c.until)}>
          <span>{c.label}</span>
          <span className="snooze-when">{clock(c.until)}</span>
        </button>
      ))}
      <form
        className="snooze-custom"
        onSubmit={(e) => {
          e.preventDefault();
          const t = new Date(custom).getTime();
          if (t > Date.now()) onPick(t);
        }}
      >
        <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Snooze until" />
        <button type="submit" disabled={!custom}>
          Set
        </button>
      </form>
      <p className="snooze-note">It comes back early if it needs you.</p>
    </div>
  );
}

/** A chat's first message, as the thread's name. */
export function useChatTitle(paneId: string) {
  return useChat((s) => {
    const first = s.byPane[paneId]?.transcript.items.find((i) => i.kind === "user");
    return first?.kind === "user" ? first.text.replace(/\s+/g, " ").trim().slice(0, 80) : undefined;
  });
}

function PrBadge({ pr, attention, onOpen }: { pr: PrInfo; attention: string | null; onOpen: () => void }) {
  const tone = pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.conflicts || pr.checks === "fail" || attention ? "bad" : pr.checks === "pass" ? "ok" : "";
  const what =
    pr.state !== "OPEN"
      ? pr.state.toLowerCase()
      : [pr.draft && "draft", pr.checks !== "none" && `checks ${pr.checks}`, pr.conflicts && "conflicts", pr.review && pr.review.toLowerCase().replace(/_/g, " ")].filter(Boolean).join(", ");
  return (
    <span
      role="link"
      className={`prb num ${tone}${attention ? " attn" : ""}`}
      title={`PR #${pr.number}: ${pr.title}${what ? `\n${what}` : ""}${attention ? `\nNeeds you: ${attention}` : ""}\nClick to open on GitHub`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
        void ipc.openUrl(pr.url);
      }}
    >
      <PrIcon width={12} height={12} />#{pr.number}
    </span>
  );
}

/** "now", "12m", "3h", "2d": how long since the thread last did something. */
function ago(at: number | undefined, now: number) {
  if (!at) return "";
  const m = Math.floor((now - at) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function Lead({ v, pane, running }: { v: Visual | undefined; pane: PaneMeta | undefined; running: boolean }) {
  // Chat panes have their own live status even when no hook session is attached.
  const chat = useChat((s) => (pane ? s.byPane[pane.id] : undefined));
  const cv: Visual | undefined = chat
    ? chat.status === "waiting"
      ? "needs_input"
      : chat.status === "working"
        ? "working"
        : chat.status === "idle"
          ? "idle"
          : undefined
    : undefined;
  const state = v ?? cv;
  if (state === "needs_input") return <span className="dot-needs" aria-label="needs you" />;
  if (state) return <JellyIcon className={state === "working" || state === "starting" ? "working" : state === "done" ? "done" : "idle"} aria-label={stateLabel[state]} />;
  if (pane?.browser) return <GlobeIcon className="th-ico" />;
  return <TerminalIcon className={`th-ico${running ? " busy" : ""}`} />;
}

/** Gives a chat thread a title taken from its latest substantive message. No model call, so it is free. */
export function retitleThread(paneId: string) {
  const items = useChat.getState().byPane[paneId]?.transcript.items ?? [];
  const t = retitle(items as { kind: string; text?: string }[]);
  if (!t) return toast("Nothing in this thread to title it from", true);
  useLayout.getState().updatePane(paneId, { title: t });
  toast(`Titled "${t}"`);
}

/** Right-click or ⇧F10 on a thread. */
function ThreadMenu({ paneId, pinned, away, onSnooze }: { paneId: string; pinned: boolean; away: boolean; onSnooze: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const prefs = useUi((s) => s.prefs);
  const pr = usePrs((s) => {
    const d = paneDir(paneId);
    return d ? s.byDir[d] : undefined;
  });
  const isChat = useLayout((s) => s.panes[paneId]?.mode === "chat");
  const close = () => {
    useUi.getState().set({ threadMenu: null });
    // Keys keep working in the list: focus goes back to the thread row (if it still exists).
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-thread="${paneId}"] .th-row`)?.focus());
  };
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const out = (e: globalThis.MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    window.addEventListener("mousedown", out);
    return () => window.removeEventListener("mousedown", out);
  }, []);
  const item = (label: string, run: () => void, key?: string) => (
    <button
      role="menuitem"
      onClick={() => {
        close();
        run();
      }}
    >
      <span>{label}</span>
      {key && <span className="snooze-when">{key}</span>}
    </button>
  );
  const move = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    e.stopPropagation();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[stepFocus(items.length, i, e.key)]?.focus();
  };
  return (
    <div ref={ref} className="snooze-menu thread-menu" role="menu" aria-label="Thread actions" onKeyDown={move}>
      {prefs.pin && !away && item(pinned ? "Unpin" : "Pin", () => patchThreads([paneId], pinPatch(!pinned, Date.now()), pinned ? "Unpinned" : "Pinned"))}
      {item("Rename", () => useUi.getState().set({ renameThread: paneId }), "F2")}
      {prefs.regenTitle && isChat && item("Retitle from latest message", () => retitleThread(paneId))}
      {prefs.prCopy && pr && item(`Copy PR link (${prNumberRef(pr.number)})`, () => copyText(pr.url, "PR link copied"))}
      {prefs.prCopy && pr && item("Copy PR number", () => copyText(prNumberRef(pr.number), `Copied ${prNumberRef(pr.number)}`))}
      {!away && item("Snooze…", onSnooze)}
      {away ? item("Wake", () => patchThreads([paneId], { settled: false, snoozedUntil: undefined }, "Woke")) : item("Settle", () => patchThreads([paneId], settlePatch(), "Settled"))}
      {item("Close", () => closePaneSafely(paneId))}
    </div>
  );
}

interface RowDnd {
  start(): void;
  end(): void;
  /** Dropped on this row (reorders when it is pinned). */
  drop(): void;
  dragging: boolean;
}

function PaneRow({ paneId, focused, snoozed, selected, now, onSelect, dnd }: { paneId: string; focused: boolean; snoozed: boolean; selected: boolean; now: number; onSelect: (e: MouseEvent) => boolean; dnd?: RowDnd }) {
  const pane = useLayout((s) => s.panes[paneId]);
  const agent = useAgents((s) => s.sessions[paneId]);
  const running = useRuntime((s) => s.panes[paneId]?.running);
  const git = useGit((s) => {
    const d = paneDir(paneId);
    return d ? s.info[d] : undefined;
  });
  const pr = usePrs((s) => {
    const d = paneDir(paneId);
    return d ? s.byDir[d] : undefined;
  });
  const [menu, setMenu] = useState(false);
  const title = useChatTitle(paneId);
  const task = useTasks((s) => tasksForPane(s.projects, paneId).find((t) => t.status === "doing") ?? tasksForPane(s.projects, paneId)[0]);
  const custom = usePaneAgent(paneId);
  const account = pane?.account ?? agent?.account;
  const isClaude = !!agent || !!account;
  const v: Visual | undefined = agent ? visualOf(agent) : isClaude ? "starting" : undefined;
  const kind = pane?.browser ? "Browser" : pane?.editor ? (pane.editor.path.split("/").pop() ?? "Editor") : pane?.launcher ? "New thread" : custom ? custom.name : isClaude ? (account ?? "Claude") : (running?.split(/\s+/)[0] ?? "Terminal");
  const label = pane?.title ?? title ?? task?.title ?? kind;
  const dir = paneDir(paneId);
  const repo = basename(git?.repo ?? dir) || "~";
  const attention = prAttention(pr, pane?.prSeenFeedback);
  const status = agent ? (agent.status === "working" && agent.tool ? agent.tool : stateLabel[visualOf(agent)]) : running && !isClaude ? "running" : "";
  const when = snoozed && pane?.snoozedUntil ? `until ${clock(pane.snoozedUntil)}` : v === "working" ? "now" : ago(agent?.updatedAt, now);
  const update = useLayout.getState().updatePane;
  const away = pane?.settled || snoozed;
  const prefs = useUi((s) => s.prefs);
  const renaming = useUi((s) => s.renameThread === paneId);
  const menuOpen = useUi((s) => s.threadMenu === paneId);

  return (
    <div
      className={`nav-thread${focused ? " on" : ""}${away ? " away" : ""}${selected ? " selected" : ""}${dnd?.dragging ? " dragging" : ""}`}
      data-thread={paneId}
      draggable={!!dnd && !renaming && !menu && !menuOpen}
      onDragStart={(e) => {
        if (!dnd) return;
        // A private type, so a text box never accepts the drop as text.
        e.dataTransfer.setData("application/x-aurelia-thread", paneId);
        e.dataTransfer.effectAllowed = "move";
        dnd.start();
      }}
      onDragEnd={() => dnd?.end()}
      onDragOver={(e) => dnd && e.preventDefault()}
      onDrop={(e) => {
        if (!dnd) return;
        e.preventDefault();
        e.stopPropagation();
        dnd.drop();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        useUi.getState().set({ threadMenu: paneId });
      }}
    >
      <button
        className={`th-row${v ? ` ${v}` : ""}`}
        onClick={(e) => onSelect(e) || showPane(paneId)}
        // Middle-click closes the thread (the same safe close as the Close button); mousedown is cancelled so the OS doesn't start autoscroll.
        onMouseDown={(e) => e.button === 1 && prefs.middleClick && e.preventDefault()}
        onAuxClick={(e) => {
          if (e.button !== 1 || !prefs.middleClick) return;
          e.preventDefault();
          closePaneSafely(paneId);
        }}
        title={[label !== kind ? `${kind}: ${label}` : label, status, dir, "⌘-click to select several", "middle-click to close"].filter(Boolean).join("\n")}
        aria-current={focused ? "true" : undefined}
        aria-selected={selected}
      >
        <span className="th-t">
          <Lead v={v} pane={pane} running={!!running} />
          <span className="th-title">{label}</span>
          {prefs.pin && pane?.pinned !== undefined && <span className="th-pin" title="Pinned" aria-label="Pinned">📌</span>}
          {pane?.babysit && (
            <span className="th-babysit" title={`Babysitting its PR: woken ${pane.babysitWakes ?? 0} times (turn it off in Details)`}>
              ◉
            </span>
          )}
        </span>
        <span className="th-m">
          <span className="th-repo">{repo}</span>
          {git && (
            <>
              <i>·</i>
              <span className="th-br">{git.branch}</span>
            </>
          )}
          {pr && <PrBadge pr={pr} attention={attention} onOpen={() => update(paneId, { prSeenFeedback: pr.feedback })} />}
          {when && <time>{when}</time>}
        </span>
      </button>
      <span className={`nav-thread-actions${menu ? " open" : ""}`}>
        {away ? (
          <>
            {git?.worktree && (
              <button className="nav-act" title="Close this thread and remove its worktree (only when it has no uncommitted changes)" onClick={() => void cleanUpWorktree(git.root)}>
                Clean up
              </button>
            )}
            <button className="nav-act" title="Back to the active threads" onClick={() => patchThreads([paneId], { settled: false, snoozedUntil: undefined }, "Woke")}>
              Wake
            </button>
            <button className="nav-act" title="Close this thread for good (Settle only files it away)" onClick={() => closePaneSafely(paneId)}>
              Close
            </button>
          </>
        ) : (
          <>
            {prefs.pin && (
              <button className="nav-act" title={pane?.pinned !== undefined ? "Unpin" : "Pin above the other threads"} onClick={() => patchThreads([paneId], pinPatch(pane?.pinned === undefined, Date.now()), pane?.pinned === undefined ? "Pinned" : "Unpinned")}>
                {pane?.pinned !== undefined ? "Unpin" : "Pin"}
              </button>
            )}
            <button className="nav-act" title="Snooze: out of the way until a time you pick, or until it needs you" onClick={() => setMenu(!menu)}>
              Snooze
            </button>
            <button className="nav-act" title="Settle: done for now, move it under Settled" onClick={() => patchThreads([paneId], settlePatch(), "Settled")}>
              Settle
            </button>
          </>
        )}
        {menu && (
          <SnoozeMenu
            onClose={() => setMenu(false)}
            onPick={(until) => {
              patchThreads([paneId], { snoozedUntil: until }, "Snoozed");
              setMenu(false);
            }}
          />
        )}
      </span>
      {renaming && (
        // Outside the row's <button>: an input inside a button mis-handles focus and Space in WebKit.
        <input
          className="th-rename"
          autoFocus
          defaultValue={pane?.title ?? label}
          aria-label="Thread name"
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              update(paneId, { title: cleanTitle(e.currentTarget.value) });
              useUi.getState().set({ renameThread: null });
            } else if (e.key === "Escape") useUi.getState().set({ renameThread: null });
          }}
          onBlur={() => useUi.getState().set({ renameThread: null })}
        />
      )}
      {menuOpen && (
        <ThreadMenu
          paneId={paneId}
          pinned={pane?.pinned !== undefined}
          away={!!away}
          onSnooze={() => setMenu(true)}
        />
      )}
    </div>
  );
}

/** Worktrees AureliaSpace made for this repo that no open pane uses any more. */
function useLeftovers(roots: string[], panes: unknown, version: number) {
  const [byRoot, setByRoot] = useState<Record<string, WorktreeEntry[]>>({});
  const key = roots.join("\n");
  useEffect(() => {
    let live = true;
    void Promise.all(roots.map((r) => ipc.listWorktrees(r).catch(() => [] as WorktreeEntry[]))).then((lists) => {
      if (!live) return;
      const used = Object.keys(useLayout.getState().panes).map(paneDir).filter(Boolean) as string[];
      const free = (w: WorktreeEntry) => !used.some((d) => d === w.path || d.startsWith(`${w.path}/`));
      setByRoot(Object.fromEntries(roots.map((r, i) => [r, (lists[i] ?? []).filter(free)])));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, panes, version]);
  return byRoot;
}

/** Shown while a phone is connected to the remote (Settings → Remote): it can read and reply to threads. */
function PhoneStatus() {
  const clients = useRemote((s) => s.clients);
  if (!clients) return null;
  const label = clients === 1 ? "Phone connected" : `${clients} phones connected`;
  return (
    <button className="side-remote" title={`${label}: it can read and reply to threads (Settings → Remote)`} onClick={() => useUi.getState().set({ settingsOpen: true, settingsSection: "remote" })}>
      <i />
      <PhoneIcon width={13} height={13} />
      {label}
    </button>
  );
}

type Group = { key: "pinned" | "needs" | "work" | "recent"; label: string; ids: string[] };

/** Every open pane as a thread, grouped by what it needs: you, time, or nothing. Snoozed and settled ones fold away below. */
export function ProjectsSidebar() {
  const tabs = useLayout((s) => s.tabs);
  const panes = useLayout((s) => s.panes);
  const activeTabId = useLayout((s) => s.activeTabId);
  const sessions = useAgents((s) => s.sessions);
  const git = useGit((s) => s.info);
  const prs = usePrs((s) => s.byDir);
  const chats = useChat((s) => s.byPane);
  const [away, setAway] = useState<"snoozed" | "settled" | null>(null);
  const [filter, setFilter] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMenu, setBulkMenu] = useState(false);
  const [removed, setRemoved] = useState(0);
  const prefs = useUi((s) => s.prefs);
  // Snoozes end and ages tick on the clock, so re-check once a minute.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  // "/" focuses thread search, the way T3's sidebar does; typing in a field or terminal keeps the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const snoozed = (id: string) => (panes[id]?.snoozedUntil ?? 0) > now && sessions[id]?.status !== "needs_input";

  const focusedId = tabs.find((t) => t.id === activeTabId)?.focusedPaneId;
  const all = tabs.flatMap((t) => paneIds(t.root));
  const dirOf = (id: string) => sessions[id]?.cwd ?? panes[id]?.cwd ?? "";
  const repos = [...new Set(all.map((id) => git[dirOf(id)]?.repo).filter(Boolean) as string[])];
  const leftovers = useLeftovers(repos, panes, removed);
  const spare = Object.values(leftovers).flat();

  const shown = (id: string) => {
    if (!filter.trim()) return true;
    const first = chats[id]?.transcript.items.find((i) => i.kind === "user");
    const d = dirOf(id);
    const g = git[d];
    return matchesFilter(filter, [basename(g?.repo ?? d), first?.kind === "user" ? first.text : undefined, panes[id]?.account, d, g?.branch, prs[d] ? `#${prs[d]!.number} ${prs[d]!.title}` : undefined]);
  };
  const visible = all.filter(shown);
  const snoozedIds = visible.filter((id) => snoozed(id) && !panes[id]?.settled);
  const settledIds = visible.filter((id) => panes[id]?.settled);
  const activeAll = visible.filter((id) => !snoozed(id) && !panes[id]?.settled);
  const { pinned: pinnedIds, rest: active } = prefs.pin ? splitPinned(activeAll, panes) : { pinned: [] as string[], rest: activeAll };
  const st = (id: string) => (sessions[id] ? visualOf(sessions[id]) : undefined);
  const groups: Group[] = [
    { key: "pinned", label: "Pinned", ids: pinnedIds },
    { key: "needs", label: "Needs you", ids: active.filter((id) => st(id) === "needs_input") },
    { key: "work", label: "Working", ids: active.filter((id) => st(id) === "working" || st(id) === "starting" || (!sessions[id] && (panes[id]?.account || panes[id]?.mode === "chat"))) },
    { key: "recent", label: "Recent", ids: [] },
  ];
  const grouped = new Set(groups.flatMap((g) => g.ids));
  groups[3].ids = active.filter((id) => !grouped.has(id)).sort((a, b) => (sessions[b]?.updatedAt ?? 0) - (sessions[a]?.updatedAt ?? 0));

  const live = [...selected].filter((id) => panes[id]);
  const select = (id: string) => (e: MouseEvent) => {
    if (!e.metaKey && !e.shiftKey && live.length === 0) return false;
    const next = new Set(live);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    return true;
  };
  const bulk = (patch: Partial<PaneMeta>) => {
    patchThreads(live, patch, patch.settled === true ? "Settled" : patch.snoozedUntil !== undefined ? "Snoozed" : "Woke");
    setSelected(new Set());
    setBulkMenu(false);
  };
  const bulkCleanUp = async () => {
    const roots = new Set(live.map((id) => git[dirOf(id)]).filter((g) => g?.worktree).map((g) => g!.root));
    setSelected(new Set());
    for (const r of roots) await cleanUpWorktree(r);
  };
  // Drag a thread between sections: pin, settle, wake. The target section shows what a drop would do.
  const [drag, setDrag] = useState<{ id: string; over: Zone | null } | null>(null);
  const zoneId = (id: string): Zone => zoneOf({ pinned: panes[id]?.pinned, settled: panes[id]?.settled, snoozed: snoozed(id) && !panes[id]?.settled });
  const planFor = (to: Zone) => (drag ? dropPlan(zoneId(drag.id), to, Date.now()) : null);
  const finishDrop = (to: Zone, beforeId: string | null = null) => {
    if (!drag) return;
    const from = zoneId(drag.id);
    let plan = dropPlan(from, to, Date.now());
    if (to === "pinned") {
      const order = pinnedIds.map((id) => ({ id, pinned: panes[id]!.pinned! }));
      const key = pinKeyBefore(order, drag.id, beforeId, Date.now());
      if (from === "pinned") plan = beforeId === drag.id ? null : { patch: { pinned: key }, verb: "Moved", label: "Move" };
      else if (plan) plan = { ...plan, patch: { ...plan.patch, pinned: key } };
    }
    setDrag(null);
    if (plan) patchThreads([drag.id], plan.patch, plan.verb);
  };
  const zoneProps = (to: Zone) =>
    prefs.dragSections && drag
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (!planFor(to) && !(to === "pinned" && zoneId(drag.id) === "pinned")) return;
            e.preventDefault();
            e.stopPropagation();
            if (drag.over !== to) setDrag({ ...drag, over: to });
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            finishDrop(to);
          },
        }
      : {};
  const overLabel = (to: Zone) => (drag?.over === to ? (to === "pinned" && zoneId(drag.id) === "pinned" ? "Move" : planFor(to)?.label) : undefined);
  const row = (id: string) => (
    <PaneRow
      key={id}
      paneId={id}
      focused={id === focusedId}
      snoozed={snoozed(id)}
      selected={live.includes(id)}
      now={now}
      onSelect={select(id)}
      dnd={
        prefs.dragSections && !filter.trim()
          ? { start: () => setDrag({ id, over: null }), end: () => setDrag(null), drop: () => finishDrop(zoneId(id), id), dragging: drag?.id === id }
          : undefined
      }
    />
  );
  const set = useUi.getState().set;

  return (
    <div className="side">
      {live.length > 0 ? (
        <div className="nav-bulk" role="toolbar" aria-label="Selected threads">
          <span className="nav-bulk-count num">{live.length} selected</span>
          <span className="nav-bulk-acts">
            <button className="nav-act" onClick={() => setBulkMenu(!bulkMenu)}>
              Snooze
            </button>
            <button className="nav-act" onClick={() => bulk(settlePatch())}>
              Settle
            </button>
            <button className="nav-act" onClick={() => bulk({ settled: false, snoozedUntil: undefined })}>
              Wake
            </button>
            {live.some((id) => git[dirOf(id)]?.worktree) && (
              <button className="nav-act" title="Close these threads and remove their worktrees (skips any with uncommitted changes)" onClick={() => void bulkCleanUp()}>
                Clean up
              </button>
            )}
            <button
              className="nav-act"
              title="Close these threads for good"
              onClick={() => {
                // Keep the selection when the unsaved-edits guard refuses, so the
                // "close again to discard" retry still has the same threads.
                if (closePanesSafely(live)) setSelected(new Set());
              }}
            >
              Close
            </button>
            <button className="nav-act" title="Clear the selection" onClick={() => setSelected(new Set())}>
              ✕
            </button>
          </span>
          {bulkMenu && <SnoozeMenu onClose={() => setBulkMenu(false)} onPick={(until) => bulk({ snoozedUntil: until })} />}
        </div>
      ) : (
        <div className="side-top">
          <label className="side-search">
            <SearchIcon width={13} height={13} />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search threads"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setFilter("");
                  e.currentTarget.blur();
                }
              }}
              aria-label="Search threads"
            />
            {filter ? (
              <button type="button" className="side-search-clear" aria-label="Clear search" onClick={() => { setFilter(""); searchRef.current?.focus(); }}>
                ×
              </button>
            ) : (
              <kbd>/</kbd>
            )}
          </label>
          <button className="find" aria-label="New thread" title="New thread (⌘N)" onClick={() => useLayout.getState().newTab({ launcher: true })}>
            <PlusIcon />
          </button>
        </div>
      )}
      <div
        className="side-list"
        role="tree"
        aria-label="Threads"
        {...zoneProps("active")}
        onKeyDown={(e) => {
          // Keys inside an open thread menu or a text box belong to those, not to the list.
          if (!prefs.sidebarKeys || e.target instanceof HTMLInputElement || (e.target as HTMLElement).closest("[role=menu]")) return;
          const row = (e.target as HTMLElement).closest<HTMLElement>("[data-thread]");
          const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(".th-row")];
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            const i = rows.indexOf(row?.querySelector(".th-row") as HTMLElement);
            rows[stepFocus(rows.length, i, e.key)]?.focus();
          } else if (e.key === "F2" && row) {
            e.preventDefault();
            useUi.getState().set({ renameThread: row.dataset.thread! });
          } else if ((e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) && row) {
            e.preventDefault();
            useUi.getState().set({ threadMenu: row.dataset.thread! });
          }
        }}
      >
        {groups.map((g) => {
          const zone: Zone = g.key === "pinned" ? "pinned" : "active";
          // While dragging, an empty Pinned strip shows up so there is somewhere to drop.
          const showEmptyPinned = g.key === "pinned" && g.ids.length === 0 && prefs.pin && prefs.dragSections && !!drag;
          if (g.ids.length === 0 && !showEmptyPinned) return null;
          return (
            <section key={g.key} className={`grp ${g.key}${drag?.over === zone ? " drop-over" : ""}`} {...(g.key === "pinned" ? zoneProps("pinned") : {})}>
              <h3>
                {g.label}
                <span className="n num">{g.ids.length}</span>
                {overLabel(zone) && g.key === "pinned" && <span className="drop-label">{overLabel(zone)}</span>}
              </h3>
              {g.ids.map(row)}
              {showEmptyPinned && <p className="drop-hint">Drop here to pin</p>}
            </section>
          );
        })}
        {(away === "snoozed" || filter.trim()) && snoozedIds.length > 0 && (
          <section className="grp" {...zoneProps("snoozed")}>
            <h3>
              Snoozed<span className="n num">{snoozedIds.length}</span>
            </h3>
            {snoozedIds.map(row)}
          </section>
        )}
        {(away === "settled" || filter.trim()) && settledIds.length > 0 && (
          <section className={`grp${drag?.over === "settled" ? " drop-over" : ""}`} {...zoneProps("settled")}>
            <h3>
              Settled<span className="n num">{settledIds.length}</span>
              {overLabel("settled") && <span className="drop-label">{overLabel("settled")}</span>}
            </h3>
            {settledIds.map(row)}
          </section>
        )}
        {visible.length === 0 && <p className="side-empty">{filter.trim() ? "No thread matches." : "No threads yet. Start one with ⌘N."}</p>}
      </div>
      <div className="side-foot">
        <button className={`bk${away === "snoozed" ? " on" : ""}`} onClick={() => setAway(away === "snoozed" ? null : "snoozed")} aria-pressed={away === "snoozed"}>
          Snoozed<span className="num">{snoozedIds.length}</span>
        </button>
        <button
          className={`bk${away === "settled" ? " on" : ""}${drag?.over === "settled" ? " drop-over" : ""}`}
          onClick={() => setAway(away === "settled" ? null : "settled")}
          aria-pressed={away === "settled"}
          {...zoneProps("settled")}
        >
          Settled<span className="num">{overLabel("settled") ?? settledIds.length}</span>
        </button>
        {spare.length > 0 && (
          <div className="bk leftover" title={spare.map((w) => `${w.branch}${w.dirty ? " (uncommitted changes)" : ""}`).join("\n")}>
            {spare.length} unused {spare.length === 1 ? "worktree" : "worktrees"}
            <button
              className="nav-act"
              title="Remove the ones without uncommitted changes"
              onClick={async () => {
                const clean = spare.filter((w) => !w.dirty);
                for (const w of clean) await ipc.removeWorktree(w.path).catch((e) => toast(String(e), true));
                const kept = spare.length - clean.length;
                toast(`Removed ${clean.length} ${clean.length === 1 ? "worktree" : "worktrees"}${kept ? `; kept ${kept} with uncommitted changes` : ""}.`);
                setRemoved(removed + 1);
              }}
            >
              Clean up
            </button>
          </div>
        )}
        <div className="foot">
          <button className="ib" aria-label="Settings" title="Settings (⌘,)" onClick={() => set({ settingsOpen: true })}>
            <GearIcon />
          </button>
          <button className="ib" aria-label="Command palette" title="Go to a thread or action (⌘P)" onClick={() => set({ paletteOpen: true })}>
            <span className="kbd">⌘P</span>
          </button>
          <button className="ib" aria-label="Project files" title="Files, search and problems (⇧⌘F)" onClick={() => set({ nav: "files" })}>
            <FolderIcon />
          </button>
          <button className="ib" aria-label="Conversation log" title="The focused thread's conversation as a log (⌥⌘T)" onClick={() => set({ nav: "thread" })}>
            <LogIcon />
          </button>
          <PhoneStatus />
        </div>
      </div>
    </div>
  );
}
