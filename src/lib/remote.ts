import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import type { RemotePane, Snapshot } from "../remote/Remote";
import { visualOf } from "../components/StatusGlyph";
import { paneTitle } from "../components/TitleBar";
import { useAgents, type AgentSession } from "../store/agents";
import { useConfig } from "../store/config";
import { useNotices } from "../store/notifications";
import { customAgentById, useCustomAgents } from "../store/customAgents";
import { paneIds, useLayout } from "../store/layout";
import { useRecents } from "../store/recents";
import { useRuntime } from "../store/runtime";
import { basename } from "./format";
import { ipc } from "./ipc";
import { answerPermission, permissionOptions, type PermissionChoice } from "./permissions";
import { riskOf } from "./risk";
import { answerApproval, interruptChat, queueFirstMessage, sendChat, useChat } from "./chat";
import { botProviders, chatSummary, chatVisual, convTail, refuse, watching, type BotAction, type BotProvider } from "./aureliaBot";
import { chatProviderId, chatUnavailable } from "./providers";
import { loadProviders, useProviders } from "../store/providers";

/** Phones connected to the remote (src-tauri/src/remote.rs), for the status bar. */
export const useRemote = create<{ clients: number }>(() => ({ clients: 0 }));

let created: Snapshot["created"];
/** Chat panes a phone has open, and when it last asked (AureliaBot sends their conversation). */
const watch = new Map<string, number>();
/** The last refused AureliaBot action, so the phone can say why. */
let refused: Snapshot["refused"];

function providers(): BotProvider[] {
  return botProviders((useProviders.getState().list ?? []).map((p) => ({ id: p.id, provider: p.provider, label: p.label, models: p.models, why: chatUnavailable(p) })));
}

/** What a permission request is about, so an answer can be matched to the request it was for. */
const askKey = (s: AgentSession) => `${s.tool ?? ""}\u0000${s.toolInput?.command ?? s.toolInput?.file_path ?? s.toolInput?.url ?? ""}\u0000${s.message ?? ""}`;

/** Read off the screen, so only a dialog that is really showing gets buttons on the phone. */
function permissionFor(s: AgentSession): RemotePane["permission"] {
  const opts = s.status === "needs_input" ? permissionOptions(s.paneId) : null;
  if (!opts) return undefined;
  const what = s.toolInput?.command ?? s.toolInput?.file_path ?? s.toolInput?.url;
  return { always: opts.always, tool: s.tool, what, risk: riskOf(s.tool, s.toolInput, s.cwd)?.why, key: askKey(s) };
}

function snapshot(): Snapshot {
  const { tabs, panes } = useLayout.getState();
  const sessions = useAgents.getState().sessions;
  const runtime = useRuntime.getState().panes;
  const chats = useChat.getState().byPane;
  const seen = new Set(watching(watch, Date.now()));
  const provs = useProviders.getState().list ?? [];
  const list: RemotePane[] = tabs.flatMap((tab, i) =>
    paneIds(tab.root).flatMap((id) => {
      const pane = panes[id];
      // Terminals only: browser, editor and start-screen panes have nothing to drive.
      if (!pane || pane.browser || pane.editor || pane.launcher) return [];
      const s = sessions[id];
      const c = pane.mode === "chat" ? chats[id] : undefined;
      const cwd = s?.cwd ?? pane.cwd;
      const title = customAgentById(pane.customAgent)?.name ?? pane.agent?.split(":")[0] ?? (pane.account || s ? "claude" : paneTitle(cwd, runtime[id]?.running));
      return [
        {
          id,
          title,
          where: basename(cwd) || undefined,
          account: s?.account ?? pane.account,
          tab: i + 1,
          status: s ? visualOf(s) : c ? chatVisual(c.status) : "shell",
          message: s?.status === "needs_input" ? s.message : s?.status === "working" && s.tool ? `running ${s.tool}` : undefined,
          permission: s && !c ? permissionFor(s) : undefined,
          ...(c && {
            chat: chatSummary(c, pane.goal, provs.find((p) => p.id === chatProviderId(pane.account, pane.provider))?.label),
            ...(seen.has(id) && { conv: convTail(c.transcript.items) }),
          }),
        },
      ];
    }),
  );
  const folders = [...new Set([...list.map((p) => sessions[p.id]?.cwd ?? panes[p.id]?.cwd), ...useRecents.getState().folders].filter((f): f is string => !!f))];
  return {
    panes: list,
    accounts: useConfig.getState().config?.accounts.map((a) => a.name) ?? [],
    projects: folders.slice(0, 10).map((path) => ({ name: basename(path) || path, path })),
    providers: providers(),
    created,
    refused,
  };
}

function push() {
  if (!useConfig.getState().config?.remote?.enabled) return;
  ipc.remoteSnapshot(snapshot()).catch(() => {});
}

type Action =
  | { kind: "new"; account: string | null; cwd: string | null; nonce: string }
  | { kind: "close"; pane: string }
  | { kind: "permission"; pane: string; choice: PermissionChoice; key: string }
  | BotAction;

/** AureliaBot's actions: talk to, stop, answer and start chat agents. Each is checked first. */
function botAction(a: BotAction) {
  const snap = snapshot();
  const chats = Object.fromEntries(snap.panes.filter((p) => p.chat).map((p) => [p.id, useChat.getState().byPane[p.id]]));
  const why = refuse(a, { chats, folders: (snap.projects ?? []).map((p) => p.path), providers: snap.providers ?? [] });
  if (why) {
    refused = { why, at: Date.now() };
    return push();
  }
  if (a.kind === "watch") watch.set(a.pane, Date.now());
  else if (a.kind === "say") void sendChat(a.pane, a.text.trim());
  else if (a.kind === "stop") interruptChat(a.pane);
  else if (a.kind === "approve") void answerApproval(a.pane, a.id, a.allow, !!a.always);
  else if (a.kind === "spawn") {
    const claude = a.provider.startsWith("claude:");
    const pane = useLayout.getState().newTab({
      mode: "chat",
      cwd: a.cwd,
      ...(claude ? { account: a.provider.slice("claude:".length) } : { provider: a.provider }),
      ...(a.model && a.model !== "default" && { chatModel: a.model }),
    });
    queueFirstMessage(pane, a.prompt.trim());
    watch.set(pane, Date.now());
    created = { nonce: a.nonce, pane };
  }
  push();
}

const BOT_KINDS = new Set(["watch", "say", "stop", "approve", "spawn"]);

const CHOICES: PermissionChoice[] = ["allow", "always", "deny"];

/** Keeps the phone's pane list current and runs what it asks for. */
export async function startRemote() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let late: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(push, 250);
  };
  useLayout.subscribe(soon);
  useAgents.subscribe(() => {
    soon();
    // A permission dialog draws a moment after its hook event; look again once it's up.
    clearTimeout(late);
    late = setTimeout(push, 700);
  });
  useRuntime.subscribe((s, prev) => s.panes !== prev.panes && soon());
  useCustomAgents.subscribe(soon);
  useConfig.subscribe(soon);
  useProviders.subscribe(soon);
  if (!useProviders.getState().list) void loadProviders();
  // Chats stream many updates a second: while a phone is connected, send at most two
  // snapshots a second (throttled, not debounced, so streaming never starves them).
  let chatTimer: ReturnType<typeof setTimeout> | undefined;
  useChat.subscribe(() => {
    if (!chatTimer && useRemote.getState().clients > 0)
      chatTimer = setTimeout(() => {
        chatTimer = undefined;
        push();
      }, 500);
  });
  push();

  await listen<number>("remote-clients", (e) => useRemote.setState({ clients: e.payload }));
  await listen<Action>("remote-action", (e) => {
    const a = e.payload;
    const layout = useLayout.getState();
    if (BOT_KINDS.has(a.kind)) return botAction(a as BotAction);
    if (a.kind === "new") {
      const pane = layout.newTab({ account: a.account ?? undefined, cwd: a.cwd ?? undefined });
      created = { nonce: a.nonce, pane };
      push();
    } else if (a.kind === "close" && layout.panes[a.pane]) {
      layout.closePane(a.pane);
    } else if (a.kind === "permission" && CHOICES.includes(a.choice)) {
      // Only if the pane still asks exactly what the phone showed: a tap on a stale list
      // must never answer a newer request. Otherwise the phone just gets a fresh list.
      const s = useAgents.getState().sessions[a.pane];
      if (s && askKey(s) === a.key && answerPermission(a.pane, a.choice)) useNotices.getState().resolvePane(a.pane, ["permission", "needs_input"]);
      soon();
    }
  });
}
