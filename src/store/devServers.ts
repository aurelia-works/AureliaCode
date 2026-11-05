import { create } from "zustand";
import { openInBrowserPane } from "../lib/browser";
import { ipc, type DevInfo } from "../lib/ipc";
import { paneDir } from "./git";
import { useLayout } from "./layout";
import { toast } from "./ui";

/** How long a dev server gets to answer before we show its output instead. */
const READY_MS = 60_000;
const POLL_MS = 5_000;

interface DevState {
  /** Running servers by thread. */
  byPane: Record<string, DevInfo>;
}

export const useDevServers = create<DevState>(() => ({ byPane: {} }));

const tail = (lines: string[]) => lines.slice(-4).join("\n") || "no output";

/** Any answer at all means it's listening; no-cors so a server without CORS headers still counts. */
async function answers(url: string) {
  try {
    await fetch(url, { mode: "no-cors", cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

/** Starts the thread's repo `dev` script on a free port, then opens it next to the thread once it answers. */
export async function startDevServer(paneId: string) {
  const cwd = paneDir(paneId);
  if (!cwd) return toast("This thread has no folder.", true);
  let info: DevInfo;
  try {
    info = await ipc.devServerStart(paneId, cwd);
  } catch (e) {
    return toast(String(e), true);
  }
  useDevServers.setState((s) => ({ byPane: { ...s.byPane, [paneId]: info } }));
  toast(`Starting ${info.command}`);
  const deadline = Date.now() + READY_MS;
  while (Date.now() < deadline) {
    if (!useDevServers.getState().byPane[paneId]) return;
    if (await answers(info.url)) {
      openInBrowserPane(paneId, info.url);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const log = await ipc.devServerLog(paneId).catch(() => [] as string[]);
  toast(`The dev server didn't answer on :${info.port} in ${READY_MS / 1000} s. Last output:\n${tail(log)}`, true);
}

export async function stopDevServer(paneId: string) {
  useDevServers.setState((s) => {
    const { [paneId]: _, ...rest } = s.byPane;
    return { byPane: rest };
  });
  await ipc.devServerStop(paneId).catch(() => {});
}

export function openDevServer(paneId: string) {
  const info = useDevServers.getState().byPane[paneId];
  if (info) openInBrowserPane(paneId, info.url);
}

/** Drops servers that exited on their own, and stops ones whose thread was closed. */
async function sweep() {
  const live = await ipc.devServerList().catch(() => null);
  if (!live) return;
  const panes = useLayout.getState().panes;
  const next: Record<string, DevInfo> = {};
  for (const d of live) {
    if (!panes[d.pane]) {
      void ipc.devServerStop(d.pane).catch(() => {});
    } else if (!d.running) {
      const log = await ipc.devServerLog(d.pane).catch(() => [] as string[]);
      void ipc.devServerStop(d.pane).catch(() => {});
      toast(`The dev server on :${d.port} stopped. Last output:\n${tail(log)}`, true);
    } else next[d.pane] = d;
  }
  useDevServers.setState({ byPane: next });
}

export function startDevServerWatch() {
  setInterval(() => void sweep(), POLL_MS);
}
