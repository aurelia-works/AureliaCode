import { paneDir } from "../store/git";
import { useLayout } from "../store/layout";
import { toast } from "../store/ui";
import { queueFirstMessage, useChat } from "./chat";
import { ipc, type PrInfo } from "./ipc";
import { closePaneSafely } from "./openFile";
import { scrapSeed } from "./proof";

/**
 * Scrap a thread and start over with its brief (Theo Browne, 2026-11-04: "don't be scared to
 * scrap anything"): a new chat in the same folder gets the first message again, told that the
 * last attempt can be deleted, and the old thread closes (⌘⇧T brings it back).
 */
export function scrapThread(paneId: string) {
  const layout = useLayout.getState();
  const pane = layout.panes[paneId];
  if (!pane) return;
  const first = useChat.getState().byPane[paneId]?.transcript.items.find((i) => i.kind === "user");
  const brief = (first?.kind === "user" ? first.text : undefined) ?? pane.title;
  if (!brief?.trim()) return toast("Nothing to start over from: this thread has no first message yet");
  const id = layout.newTab({ mode: "chat", cwd: pane.cwd, ...(pane.provider && { provider: pane.provider }) });
  if (pane.title) layout.updatePane(id, { title: pane.title });
  queueFirstMessage(id, scrapSeed(brief));
  closePaneSafely(paneId);
  toast("Scrapped. A new thread starts over with the same brief.");
}

/** Roll back a merged PR: a worktree with its revert, and a thread there that checks it (and doesn't push on its own). */
export async function revertMergedPr(paneId: string, pr: PrInfo) {
  const dir = paneDir(paneId);
  if (!dir || pr.state !== "MERGED") return;
  toast(`Reverting PR #${pr.number}…`);
  try {
    const r = await ipc.gitRevertPr(dir, pr.number);
    const layout = useLayout.getState();
    const id = layout.newTab({ mode: "chat", cwd: r.path });
    layout.updatePane(id, { title: `Revert #${pr.number}` });
    queueFirstMessage(
      id,
      `PR #${pr.number} ("${pr.title}") was merged and is being rolled back. This worktree is on branch ${r.branch} with ` +
        (r.conflicts
          ? "a revert of it that stopped on conflicts: resolve them, then finish with `git revert --continue`."
          : "a commit that reverts it.") +
        " Run the project's checks and tell me the result. Don't push or open a PR until I say.",
    );
  } catch (e) {
    toast(`Couldn't revert PR #${pr.number}: ${e}`, true);
  }
}
