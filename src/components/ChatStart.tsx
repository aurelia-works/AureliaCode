import { useState } from "react";
import { queueFirstMessage, restartChat, sendChat, useChat, type Outgoing } from "../lib/chat";
import { freshChat } from "../lib/chatStart";
import { basename, expandPath, shortenPath } from "../lib/format";
import { ipc } from "../lib/ipc";
import { startDir } from "../lib/launch";
import { newScratchDir } from "../lib/scratch";
import { useConfig } from "../store/config";
import { useGit } from "../store/git";
import { useLayout } from "../store/layout";
import { useRecents } from "../store/recents";
import { toast, useUi } from "../store/ui";
import { AureliaMark, CloseIcon, FolderIcon } from "./Icons";
import { FirstRunSetup } from "./StartScreen";

/**
 * An unused chat's opening, in place of the old Start screen: which project it runs in
 * (picking another restarts the chat there) and whether its first message gets a worktree.
 */
export function ChatStart({ paneId, starting }: { paneId: string; starting: boolean }) {
  const cwd = useLayout((s) => s.panes[paneId]?.cwd);
  const recents = useRecents((s) => s.folders);
  const workspace = useConfig((s) => s.config?.defaultWorkspace);
  const setupDone = useConfig((s) => s.config?.setupDone);
  const noProject = useUi((s) => s.prefs.noProject);
  const worktree = useUi((s) => s.useWorktree);
  const folder = cwd || workspace || "~";
  const git = useGit((s) => s.info[expandPath(folder)] ?? s.info[folder]);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const moveTo = (dir: string | null | undefined) => {
    setPicking(false);
    setEditing(false);
    if (!dir || dir === cwd) return;
    useLayout.getState().updatePane(paneId, { cwd: dir });
    restartChat(paneId, true);
  };

  return (
    <div className="chat-empty chat-start">
      <AureliaMark width={34} height={34} />
      <p className="chat-start-ask">
        {starting ? "Starting Claude in " : "What should Claude do in "}
        {editing ? (
          <input
            className="start-input chat-start-input"
            autoFocus
            spellCheck={false}
            placeholder="~/path/to/project"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") moveTo(expandPath(draft));
              else if (e.key === "Escape") setEditing(false);
            }}
            onBlur={() => setEditing(false)}
            aria-label="Folder path"
          />
        ) : (
          <span className="pick-wrap hello-pick">
            <button className="hello-project" title={`${shortenPath(folder)}\nClick to pick another project`} onClick={() => setPicking(!picking)} aria-expanded={picking}>
              {basename(folder) || "~"}
            </button>
            {picking && (
              <div className="pick-menu" role="menu" onMouseDown={(e) => e.preventDefault()}>
                {recents
                  .filter((r) => r !== folder)
                  .slice(0, 5)
                  .map((r) => (
                    <div key={r} className="recent-row" role="none">
                      <button role="menuitem" className="recent-open" onClick={() => moveTo(r)} title={`Start in ${r}`}>
                        <span className="recent-name">{basename(r)}</span>
                        <span className="recent-path">{shortenPath(r)}</span>
                      </button>
                      <button className="icon-btn sm recent-del" onClick={() => useRecents.getState().remove(r)} title="Remove from recents" aria-label="Remove from recents">
                        <CloseIcon width={10} height={10} />
                      </button>
                    </div>
                  ))}
                <button role="menuitem" className="pick-act" onClick={() => void ipc.pickFolder(folder).then(moveTo, () => setPicking(false))}>
                  <FolderIcon width={12} height={12} />
                  Choose folder…
                </button>
                <button role="menuitem" className="pick-act" onClick={() => (setPicking(false), setDraft(shortenPath(cwd || workspace || "")), setEditing(true))}>
                  Type a path…
                </button>
                {noProject && (
                  <button role="menuitem" className="pick-act" title="A new empty folder; its files stay after the thread is gone" onClick={() => void newScratchDir().then(moveTo, (e) => toast(String(e), true))}>
                    No project (scratch folder)
                  </button>
                )}
              </div>
            )}
          </span>
        )}
        {starting ? "…" : "?"}
      </p>
      <div className="where">
        {git ? (
          <>
            {worktree ? "new worktree from" : "on"} <span className="mono br">{git.branch}</span>
            <span className="where-sep">·</span>
            <button className="where-link" aria-pressed={worktree} title="Give this thread its own git worktree, made when you send the first message" onClick={() => useUi.getState().set({ useWorktree: !worktree })}>
              {worktree ? `Stay on ${git.branch}` : "New worktree"}
            </button>
          </>
        ) : (
          <span className="mono br">{shortenPath(folder)}</span>
        )}
      </div>
      {setupDone === false && <FirstRunSetup />}
    </div>
  );
}

/**
 * Sends a chat's first message, in a new worktree when that's switched on and the folder is a
 * git repo: the worktree is made, the unused chat restarts there, and the message goes once it's up.
 */
export async function sendFirst(paneId: string, text: string, att: Outgoing): Promise<void> {
  const pane = useLayout.getState().panes[paneId];
  const items = useChat.getState().byPane[paneId]?.transcript.items.length ?? 0;
  const dir = pane?.cwd ? expandPath(pane.cwd) : undefined;
  if (dir && useUi.getState().useWorktree && freshChat(pane, items) && useGit.getState().info[dir]) {
    const made = await startDir(dir, true, text.slice(0, 40));
    if (made && made !== dir) {
      useLayout.getState().updatePane(paneId, { cwd: made });
      queueFirstMessage(paneId, text, att);
      restartChat(paneId, true);
      return;
    }
  }
  await sendChat(paneId, text, att);
}
