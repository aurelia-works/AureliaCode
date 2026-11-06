import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { basename } from "../lib/format";
import { openInBrowserPane } from "../lib/browser";
import { closePaneSafely, openFile, useEditors } from "../lib/openFile";
import { useOutbox } from "../lib/outbox";
import { useChat } from "../lib/chat";
import { modeKey, MODES, PICKER_MODES, setPermissionMode } from "../lib/permissionMode";
import { useUi } from "../store/ui";
import { toggleVoice, useVoice } from "../lib/voice";
import { useAgents } from "../store/agents";
import { useGit } from "../store/git";
import { focusedPaneId, useLayout } from "../store/layout";
import { useRuntime } from "../store/runtime";
import { tasksForPane, useTasks } from "../store/tasks";
import { AccountSwitch } from "./AccountSwitch";
import { AgentChip, usePaneAgent } from "./AgentChip";
import { BranchIcon, CloseIcon, GlobeIcon, MicIcon, MoreIcon, OpenIcon, SplitDownIcon, SplitRightIcon } from "./Icons";
import { startPaneDrag } from "./PaneDrag";
import { useChatTitle } from "./ProjectsSidebar";
import { PermissionButtons } from "./SessionExtras";
import { StatusGlyph, visualOf } from "./StatusGlyph";

function PaneActions({ paneId, browser, editor }: { paneId: string; browser?: boolean; editor?: string }) {
  const { splitPane } = useLayout.getState();
  return (
    <span className="pane-tools">
      {editor && (
        <button className="icon-btn sm hide-narrow" title="Open in external editor" aria-label="Open in external editor" onClick={() => void openFile(editor, undefined, undefined, { external: true })}>
          <OpenIcon width={12} height={12} />
        </button>
      )}
      {!browser && !editor && (
        <button className="icon-btn sm hide-narrow" title="Open browser pane (⇧⌘B)" aria-label="Open browser pane" onClick={() => openInBrowserPane(paneId, "")}>
          <GlobeIcon />
        </button>
      )}
      <button className="icon-btn sm hide-narrow" title="Split right (⌘D)" aria-label="Split right" onClick={() => splitPane(paneId, "row")}>
        <SplitRightIcon />
      </button>
      <button className="icon-btn sm hide-narrow" title="Split down (⇧⌘D)" aria-label="Split down" onClick={() => splitPane(paneId, "column")}>
        <SplitDownIcon />
      </button>
      <button className="icon-btn sm" title="Close pane (⌘W)" aria-label="Close pane" onClick={() => closePaneSafely(paneId)}>
        <CloseIcon width={11} height={11} />
      </button>
    </span>
  );
}

/** Dictation, split, browser and close: the pane's own tools, in its header or in the thread header when it has none. */
export function PaneControls({ paneId }: { paneId: string }) {
  const launcher = useLayout((s) => !!s.panes[paneId]?.launcher);
  const voiceInstalled = useVoice((s) => s.installed);
  const voiceState = useVoice((s) => (focusedPaneId() === paneId ? s.state : "idle"));
  return (
    <>
      {voiceState !== "idle" && <span className={`voice-dot ${voiceState}`} title={`Dictation: ${voiceState}`} />}
      {voiceInstalled && !launcher && (
        <button className={`icon-btn sm mic${voiceState !== "idle" ? " live" : ""}`} title="Dictate (⌥⌘V)" aria-label="Dictate" onClick={() => toggleVoice(paneId)}>
          <MicIcon />
        </button>
      )}
      <PaneActions paneId={paneId} />
    </>
  );
}

/** The pane's permission mode; click to pick another (Claude's own Shift+Tab, pressed for you). */
export function ModeChip({ paneId }: { paneId: string }) {
  const hooked = useAgents((s) => s.sessions[paneId]?.permissionMode);
  // A chat pane hears its mode from the CLI itself, right when it changes.
  const mode = modeKey(useChat((s) => s.byPane[paneId]?.mode) ?? hooked);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [pos]);
  const m = MODES[mode] ?? MODES.default;
  return (
    <>
      <button
        ref={btn}
        className={`mode-chip${m.tone ? ` ${m.tone}` : ""}${mode === "default" ? " quiet" : ""}`}
        title={`${m.label}: ${m.what}. Click to change.`}
        onClick={() => {
          const r = btn.current?.getBoundingClientRect();
          if (r) setPos({ x: Math.min(r.left, window.innerWidth - 270), y: r.bottom + 4 });
        }}
      >
        {m.short}
      </button>
      {pos &&
        createPortal(
          <div className="account-menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="account-menu-head">Permission mode · Shift+Tab in Claude</div>
            {PICKER_MODES.map((k) => (
              <button
                key={k}
                className={k === mode ? "on" : ""}
                onClick={() => {
                  setPos(null);
                  void setPermissionMode(paneId, k);
                }}
              >
                <span className={MODES[k].tone ? `mode-${MODES[k].tone}` : undefined}>{MODES[k].label}</span>
                <span className="account-room">{MODES[k].what}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * One line, 28px: identity on the left (state, account, folder, branch), live signals in
 * the middle (state, permission answers, task), tools on hover. Usage lives in the status
 * bar and the cache timer on the board and rail, so the header stays quiet. Sits above the
 * terminal, never over it; narrow panes shed the least important parts (container queries).
 */
export function PaneHeader({ paneId }: { paneId: string }) {
  const pane = useLayout((s) => s.panes[paneId]);
  const runtime = useRuntime((s) => s.panes[paneId]);
  const agent = useAgents((s) => s.sessions[paneId]);
  const custom = usePaneAgent(paneId);
  const projects = useTasks((s) => s.projects);
  const account = pane?.account ?? agent?.account;
  const dir = agent?.cwd ?? pane?.cwd;
  const git = useGit((s) => (dir ? s.info[dir] : undefined));
  const dirty = useEditors((s) => !!s.dirty[paneId]);
  const queued = useOutbox((s) => s.byPane[paneId]?.length ?? 0);
  const headerMode = useUi((s) => s.prefs.headerModeChip);
  const single = useUi((s) => s.single);
  const chatTitle = useChatTitle(paneId);
  if (!pane) return null;

  if (pane.editor) {
    const file = pane.editor.path;
    const root = git?.root ?? dir;
    const rel = root && file.startsWith(root + "/") ? file.slice(root.length + 1) : file;
    const folder = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    return (
      <div className="pane-header" onPointerDown={(e) => startPaneDrag(e, paneId)}>
        <div className="pane-id" title={file}>
          <span className={`edit-dot${dirty ? " dirty" : ""}`} aria-label={dirty ? "Unsaved changes" : undefined} />
          <span className="pane-name">{basename(file)}</span>
          {/* LRM keeps a leading "/" in place under the rtl ellipsis trick. */}
          {folder && <span className="pane-folder hide-tight">{"\u200e" + folder}</span>}
        </div>
        <PaneActions paneId={paneId} editor={file} />
      </div>
    );
  }

  if (pane.browser) {
    return (
      <div className="pane-header" onPointerDown={(e) => startPaneDrag(e, paneId)}>
        <div className="pane-id">
          <GlobeIcon width={12} height={12} className="pane-kind" />
          <span className="pane-name">{pane.browser.url ? hostOf(pane.browser.url) : "Browser"}</span>
        </div>
        <PaneActions paneId={paneId} browser />
      </div>
    );
  }

  const attached = tasksForPane(projects, paneId);
  const task = attached.find((t) => t.status === "doing") ?? attached[0];
  const running = runtime?.running;
  const v = agent ? visualOf(agent) : undefined;

  // One header pattern with the chat view: state, folder / thread, then a labelled More menu.
  if (agent || pane.account || pane.mode === "chat") {
    const folder = basename(dir) || "~";
    const name = pane.title ?? chatTitle ?? task?.title ?? "New thread";
    return (
      <div className="pane-header one" onPointerDown={(e) => startPaneDrag(e, paneId)}>
        <div className="pane-id">
          <StatusGlyph state={v ?? "idle"} />
          <span className="pane-crumb" title={`${dir ?? ""}\n${name}`}>
            <span className="pane-crumb-folder">{folder}</span>
            {!single && (
              <>
                <span aria-hidden>/</span>
                <span className="pane-name">{name}</span>
              </>
            )}
          </span>
          {headerMode && account && (agent || pane.account ? <AccountSwitch paneId={paneId} account={account} /> : <span className="account-chip">{account}</span>)}
        </div>
        <div className="pane-signals">
          {v === "needs_input" && <PermissionButtons paneId={paneId} />}
          {queued > 0 && (
            <button className="pane-queued" title="Messages waiting for Claude to finish its turn · click to see or edit them" onClick={() => useUi.getState().set({ composerPaneId: paneId })}>
              {queued} queued
            </button>
          )}
        </div>
        <div className="pane-end">
          <PaneMenu paneId={paneId} />
        </div>
      </div>
    );
  }

  return (
    <div className="pane-header" onPointerDown={(e) => startPaneDrag(e, paneId)}>
      <div className="pane-id">
        <StatusGlyph state="shell" busy={!!running} />
        {custom && <AgentChip agent={custom} />}
        <span className="pane-name" title={dir}>
          {pane.launcher ? "New tab" : basename(dir) || "~"}
        </span>
        {git && (
          <span
            className={`git-chip hide-tight${git.worktree ? " worktree" : ""}`}
            title={`${git.detached ? "Detached HEAD" : "Branch"} ${git.branch}${git.worktree ? `\nWorktree: ${git.root}` : ""}`}
          >
            <BranchIcon width={10} height={10} />
            {git.branch}
            {git.worktree && <span className="wt">wt</span>}
          </span>
        )}
      </div>
      <div className="pane-signals">
        {running && (
          <span className="pane-running mono" title={running}>
            ▸ {running}
          </span>
        )}
        {queued > 0 && (
          <button className="pane-queued" title="Messages waiting for Claude to finish its turn · click to see or edit them" onClick={() => useUi.getState().set({ composerPaneId: paneId })}>
            {queued} queued
          </button>
        )}
        {task && (
          <span className={`pane-task hide-narrow ${task.status}`} title={`Attached task (${task.status}): ${task.title}`}>
            ◆ {task.title}
          </span>
        )}
      </div>
      <div className="pane-end">
        <PaneControls paneId={paneId} />
      </div>
    </div>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The pane's own tools behind one labelled button (the thread header's overflow): dictate,
 * browser, splits and close, each with its name and shortcut, so the header keeps a few controls.
 */
export function PaneMenu({ paneId }: { paneId: string }) {
  const voiceInstalled = useVoice((s) => s.installed);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [pos]);
  const { splitPane } = useLayout.getState();
  const items: { label: string; keys: string; run: () => void }[] = [
    ...(voiceInstalled ? [{ label: "Dictate", keys: "⌥⌘V", run: () => toggleVoice(paneId) }] : []),
    { label: "Open a browser pane", keys: "⇧⌘B", run: () => openInBrowserPane(paneId, "") },
    { label: "Split right", keys: "⌘D", run: () => splitPane(paneId, "row") },
    { label: "Split down", keys: "⇧⌘D", run: () => splitPane(paneId, "column") },
    { label: "Close this thread", keys: "⌘W", run: () => closePaneSafely(paneId) },
  ];
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="ib labelled"
        aria-haspopup="menu"
        aria-expanded={!!pos}
        aria-label="More"
        title="Dictate, browser, split and close"
        onClick={() => {
          const r = btn.current?.getBoundingClientRect();
          if (r) setPos(pos ? null : { x: Math.min(r.left, window.innerWidth - 240), y: r.bottom + 4 });
        }}
      >
        <MoreIcon width={14} height={14} />
        <span>More</span>
      </button>
      {pos &&
        createPortal(
          <div className="account-menu" role="menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
            {items.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                onClick={() => {
                  setPos(null);
                  it.run();
                }}
              >
                <span>{it.label}</span>
                <span className="account-room">{it.keys}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
