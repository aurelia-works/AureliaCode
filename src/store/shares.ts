import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { convTail } from "../lib/aureliaBot";
import { sendChat, useChat } from "../lib/chat";
import { copyText } from "../lib/copyText";
import { basename } from "../lib/format";
import { ipc, type ShareAsk } from "../lib/ipc";
import { useLayout } from "./layout";
import { alertUser } from "./notifications";
import { toast } from "./ui";

/** How often a shared thread's conversation is pushed to the server for guests. */
const PUSH_MS = 3_000;
/** Lines of conversation a guest sees. */
const GUEST_TAIL = 200;

interface ShareState {
  /** Shared threads and when their links expire (unix seconds). */
  byPane: Record<string, number>;
}

export const useShares = create<ShareState>(() => ({ byPane: {} }));

/** Only chat threads can be shared: a terminal's screen isn't a conversation a guest can read. */
export const canShare = (paneId: string) => useLayout.getState().panes[paneId]?.mode === "chat";

function feedOf(paneId: string) {
  const pane = useLayout.getState().panes[paneId];
  const chat = useChat.getState().byPane[paneId];
  const title = pane?.title ?? (chat?.transcript.items.find((i) => i.kind === "user") as { text?: string } | undefined)?.text?.slice(0, 80) ?? basename(pane?.cwd);
  return { title, status: chat?.status ?? "idle", items: chat ? convTail(chat.transcript.items, GUEST_TAIL) : [] };
}

const sent = new Map<string, string>();

async function pushFeeds() {
  for (const id of Object.keys(useShares.getState().byPane)) {
    const feed = feedOf(id);
    const key = JSON.stringify(feed);
    if (sent.get(id) === key) continue;
    if (await ipc.shareFeed(id, feed).catch(() => false)) sent.set(id, key);
  }
}

export async function shareThread(paneId: string) {
  if (!canShare(paneId)) return toast("Only chat threads can be shared.", true);
  try {
    const link = await ipc.shareCreate(paneId);
    useShares.setState((s) => ({ byPane: { ...s.byPane, [paneId]: link.expires } }));
    sent.delete(paneId);
    await pushFeeds();
    copyText(link.urls[0], "Read-only link copied. It works for 24 hours, on your tailnet; guest messages wait for your OK.");
  } catch (e) {
    toast(String(e), true);
  }
}

export async function stopSharing(paneId: string) {
  await ipc.shareRevoke(paneId).catch(() => {});
  sent.delete(paneId);
  useShares.setState((s) => {
    const { [paneId]: _, ...rest } = s.byPane;
    return { byPane: rest };
  });
  toast("Stopped sharing: the link is dead.");
}

const shown = new Set<string>();

/** A guest's message becomes a card on the Mac; it reaches the thread only if you press Send. */
async function checkAsks() {
  const asks: ShareAsk[] = await ipc.shareAsks().catch(() => []);
  for (const q of asks) {
    if (shown.has(q.id)) continue;
    shown.add(q.id);
    alertUser({
      kind: "needs_input",
      paneId: q.pane,
      sticky: true,
      key: `share-ask-${q.id}`,
      title: "A guest asks in a shared thread",
      body: q.text,
      actions: [
        {
          label: "Send to the thread",
          tone: "primary",
          run: () => {
            void ipc.shareTake(q.id).then((a) => a && useLayout.getState().panes[a.pane] && sendChat(a.pane, `A guest with the share link asks:\n\n${a.text}`));
          },
        },
        { label: "Decline", run: () => void ipc.shareTake(q.id) },
      ],
    });
  }
}

/** Keeps shared threads' guest view current and turns guest messages into approval cards. */
export async function startShares() {
  const live = await ipc.shareList().catch(() => []);
  useShares.setState({ byPane: Object.fromEntries(live.map((s) => [s.pane, s.expires])) });
  setInterval(() => {
    const now = Date.now() / 1000;
    const { byPane } = useShares.getState();
    // Expired links, and threads that were closed, stop being shared.
    for (const [id, exp] of Object.entries(byPane)) if (exp <= now || !useLayout.getState().panes[id]) void stopSharing(id);
    void pushFeeds();
    void checkAsks();
  }, PUSH_MS);
  await listen<{ kind?: string }>("remote-action", (e) => {
    if (e.payload?.kind === "shareAsk") void checkAsks();
  });
}
