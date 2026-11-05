import { useUi } from "../store/ui";
import { Channel } from "@tauri-apps/api/core";
import { create } from "zustand";
import { useAgents } from "../store/agents";
import { getConfig } from "../store/config";
import { onPanesClosed, useLayout, type PaneMeta } from "../store/layout";
import { addNotice, addUser, applyLine, emptyTranscript, endTurn, toolSummary, type SentVia, type Transcript } from "./chatModel";
import { takeReplay } from "./chatReplay";
import type { ChatDocument } from "./attachments";
import { workAfterTurn } from "./workBridge";
import { cacheSafe } from "./effort";
import { ipc, type ChatEvent, type ChatImage, type CliModel, type ChatUsage, type ContextUsage, type SlashCommand } from "./ipc";
import { chatCan, missingHistory } from "./chatStart";
import { startPermissionMode } from "./startMode";
import { refreshUsageAfterTurn } from "../store/usage";
import { runGoalCheck } from "../store/goals";

/**
 * Chat panes' live state, kept outside React like terminals.ts keeps xterm: a pane that
 * moves or remounts finds its conversation where it left it. Each pane runs Claude Code
 * headless (src-tauri/src/chat.rs); its events build the transcript (lib/chatModel.ts).
 */

export type ChatStatus = "starting" | "working" | "waiting" | "idle" | "exited";

export interface Approval {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  description?: string | null;
}

/** A message waiting behind the running turn, kept whole so it shows as sent once its turn starts. */
export interface Queued {
  text: string;
  images?: string[];
  files?: string[];
  uuid: string;
  via?: SentVia;
}

/** What a message carries besides its text: images, and files sent as document blocks. */
export interface Outgoing {
  images?: ChatImage[];
  documents?: ChatDocument[];
}

export interface ChatSession {
  transcript: Transcript;
  status: ChatStatus;
  /** Tool calls waiting for the user, oldest first. */
  approvals: Approval[];
  /** Sent while Claude was busy: the CLI runs them as the next turns, shown here until then. */
  queued: Queued[];
  /** This chat's tokens and cost so far, and the last turn's usage (context fill). */
  tokens: number;
  costUsd: number;
  last?: ChatUsage;
  /** The model the CLI says it runs, e.g. "claude-opus-5-5". */
  model?: string;
  /** Its permission mode, as the CLI last reported it. */
  mode?: string;
  /** Slash commands the CLI offers (for the composer's / menu). */
  commands?: SlashCommand[];
  /** Models and output styles the CLI offers, and the style it started with. */
  models?: CliModel[];
  styles?: string[];
  style?: string;
  /** What fills the context window, from the CLI's own count; refreshed after each turn. */
  context?: ContextUsage;
  /** When that count came. */
  contextAt?: number;
  /** What auto model / auto effort last chose, and why (shown on the pickers). */
  auto?: { model?: { pick: string; why: string }; effort?: { pick?: string; why: string } };
}

interface ChatStore {
  byPane: Record<string, ChatSession>;
}

export const useChat = create<ChatStore>(() => ({ byPane: {} }));

const blank = (): ChatSession => ({ transcript: emptyTranscript(), status: "starting", approvals: [], queued: [], tokens: 0, costUsd: 0 });

function patch(paneId: string, f: (s: ChatSession) => ChatSession) {
  useChat.setState((st) => ({ byPane: { ...st.byPane, [paneId]: f(st.byPane[paneId] ?? blank()) } }));
}

// Text streams in as many small events: apply them once per frame.
const pending = new Map<string, ChatEvent[]>();
let frame = 0;

function flush() {
  frame = 0;
  const batch = [...pending];
  pending.clear();
  for (const [paneId, events] of batch) patch(paneId, (s) => events.reduce((acc, ev) => reduce(paneId, acc, ev), s));
}

/** A fork's new session id, held until its first turn ends. */
const forkIds = new Map<string, string>();

function reduce(paneId: string, s: ChatSession, ev: ChatEvent): ChatSession {
  switch (ev.type) {
    case "raw": {
      // The CLI's echo of a message it took (often mid-turn): it leaves the queue now.
      const taken = takeReplay(s.transcript, s.queued, ev.msg);
      if (taken) return { ...s, ...taken };
      // Compaction happens without a turn ending; the number falls now, not at the next request.
      if (ev.msg.type === "system" && ev.msg.subtype === "compact_boundary") void refreshContext(paneId);
      return { ...s, transcript: applyLine(s.transcript, ev.msg), model: reportedModel(ev.msg) ?? s.model, mode: reportedMode(paneId, ev.msg) ?? s.mode };
    }
    case "controlError":
      return { ...s, transcript: addNotice(s.transcript, `Claude Code said no: ${ev.error}`, true) };
    case "status":
      return s.status === "exited" ? s : { ...s, status: ev.status };
    case "approval":
      // Headless Claude Code asks us over stdio, not through its Notification hook, so the
      // app's waiting state, alert and badge are raised here (a repeat is ignored there).
      queueMicrotask(() =>
        useAgents.getState().handle({
          pane: paneId,
          event: "Notification",
          configDir: "",
          ts: Date.now() / 1000,
          payload: {
            notification_type: "permission_prompt",
            message: ev.tool === "AskUserQuestion" ? "Claude has a question for you" : `Claude needs your permission to use ${ev.tool}`,
            tool_name: ev.tool,
          },
        }),
      );
      return { ...s, approvals: [...s.approvals, { id: ev.id, tool: ev.tool, input: ev.input, description: ev.description }] };
    case "turnEnd": {
      void refreshContext(paneId);
      queueMicrotask(() => refreshUsageAfterTurn(paneId));
      const forked = forkIds.get(paneId);
      if (forked) {
        forkIds.delete(paneId);
        queueMicrotask(() => useLayout.getState().updatePane(paneId, { claudeSession: forked, chatFork: undefined }));
      }
      workAfterTurn(paneId, ev.outcome);
      // A goal checks its command once this turn is the last one queued (store/goals.ts).
      const behind = s.queued.length;
      queueMicrotask(() => void runGoalCheck(paneId, (t) => void sendChat(paneId, t), { outcome: ev.outcome, queued: behind }));
      const u = ev.usage;
      const tokens = u ? u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens : 0;
      // Kept on the pane so a restart (app, account switch, edit) carries on counting.
      const total = { tokens: s.tokens + tokens, costUsd: s.costUsd + (u?.costUsd ?? 0) };
      queueMicrotask(() => useLayout.getState().panes[paneId] && useLayout.getState().updatePane(paneId, { chatTokens: total.tokens, chatCost: total.costUsd }));
      const [next, ...queued] = s.queued;
      const ended = endTurn(s.transcript, ev.outcome, ev.error, u, ev.durationMs);
      return {
        ...s,
        // A queued message starts the next turn now.
        transcript: next === undefined ? ended : addUser(ended, next.text, Date.now(), next),
        queued,
        approvals: [],
        ...total,
        last: u ?? s.last,
      };
    }
    case "exit": {
      const why = ev.code ? `Claude stopped (exit ${ev.code})${ev.stderr.trim() ? `: ${ev.stderr.trim().split("\n").slice(-3).join(" ")}` : ""}` : "Claude stopped";
      useAgents.getState().remove(paneId);
      return { ...s, status: "exited", approvals: [], queued: [], transcript: addNotice(endStreaming(s.transcript), why, !!ev.code) };
    }
    case "session": {
      const pane = useLayout.getState().panes[paneId];
      // A fork's own transcript exists only once its first turn is saved; until then a restart resumes the original as a copy again.
      if (pane?.chatFork) forkIds.set(paneId, ev.id);
      else if (pane && pane.claudeSession !== ev.id) useLayout.getState().updatePane(paneId, { claudeSession: ev.id });
      return s;
    }
  }
}

/** The model named by the CLI's init line, or by its answer to a model switch. */
function reportedModel(m: Record<string, any>): string | undefined {
  if (m.type === "system" && m.subtype === "init" && typeof m.model === "string") return m.model;
  if (m.type === "control_response" && typeof m.response?.response?.model === "string") return m.response.response.model;
  return undefined;
}

/** The permission mode from the CLI's init and status lines (it changes by itself, e.g. leaving plan mode), or its answer to a switch. */
function reportedMode(paneId: string, m: Record<string, any>): string | undefined {
  const mode = m.type === "system" ? m.permissionMode : m.type === "control_response" ? m.response?.response?.mode : undefined;
  if (typeof mode !== "string") return undefined;
  if (useLayout.getState().panes[paneId]?.chatPermission !== mode) useLayout.getState().updatePane(paneId, { chatPermission: mode });
  // The ⌘J board and HUD read the agent's mode; hooks only report it on their next event.
  const agent = useAgents.getState().sessions[paneId];
  if (agent && agent.permissionMode !== mode)
    queueMicrotask(() => useAgents.setState((st) => (st.sessions[paneId] ? { sessions: { ...st.sessions, [paneId]: { ...st.sessions[paneId], permissionMode: mode } } } : st)));
  return mode;
}

function endStreaming(t: Transcript): Transcript {
  return { ...t, items: t.items.map((i) => ((i.kind === "text" || i.kind === "thinking") && !i.done ? { ...i, done: true } : i)), open: {} };
}

function onEvent(paneId: string, token: number, ev: ChatEvent) {
  // A process this pane already let go of (closed, restarted) may still be talking.
  if (spawns.get(paneId) !== token) return;
  const list = pending.get(paneId) ?? [];
  list.push(ev);
  pending.set(paneId, list);
  if (!frame) frame = requestAnimationFrame(flush);
}

/** A first message for a chat that is still starting (e.g. opened by another agent). */
const firstMessage = new Map<string, { text: string; att?: Outgoing }>();

export function queueFirstMessage(paneId: string, text: string, att?: Outgoing) {
  firstMessage.set(paneId, { text, att });
}

/** Each pane's current spawn; events from older ones are dropped. */
const spawns = new Map<string, number>();
let spawnSeq = 0;

/** Starts the pane's Claude once; a resumed chat first shows the conversation so far. */
export async function ensureChat(pane: PaneMeta) {
  if (spawns.has(pane.id)) return;
  const token = ++spawnSeq;
  spawns.set(pane.id, token);
  patch(pane.id, () => ({ ...blank(), tokens: pane.chatTokens ?? 0, costUsd: pane.chatCost ?? 0 }));
  let resume = pane.claudeSession;
  const branch = branches.get(pane.id);
  branches.delete(pane.id);
  const fork = !!pane.chatFork;
  const oc = isOpenCode(pane);
  if (resume && oc) {
    // OpenCode keeps the conversation in its own store; the next message continues it.
    patch(pane.id, (s) => ({ ...s, transcript: addNotice(s.transcript, "Earlier messages are in OpenCode's session; new ones continue it") }));
  } else if (resume) {
    let readError = "";
    let lines = await ipc.chatHistory(pane.account, pane.cwd ?? "", resume).catch((e: unknown) => {
      readError = String(e);
      return null;
    });
    // A branch shows the conversation up to the edited message.
    const cut = branch ? (lines?.findIndex((l) => l.uuid === branch.before) ?? -1) : -1;
    if (lines && cut >= 0) lines = lines.slice(0, cut);
    if (lines) patch(pane.id, (s) => ({ ...s, transcript: lines.reduce<Transcript>((t, l) => applyLine(t, l), s.transcript) }));
    else {
      // An unused chat's session (assigned at spawn) has no file yet: drop it quietly; freshChat
      // ignores the session, so the project picker stays. A used chat keeps chatUsed and says why.
      const miss = missingHistory(readError, !!pane.chatUsed);
      if (miss.clearSession) {
        resume = undefined;
        useLayout.getState().updatePane(pane.id, { claudeSession: undefined });
      }
      const notice = miss.notice;
      if (notice) patch(pane.id, (s) => ({ ...s, transcript: addNotice(s.transcript, notice) }));
    }
  }
  if (spawns.get(pane.id) !== token) return;
  // The new process starts with the pane's picks as flags.
  configPending.delete(pane.id);
  const startEffort = real(chatPicks(pane).effort);
  if (startEffort && startEffort !== "default") appliedEffort.set(pane.id, startEffort);
  else appliedEffort.delete(pane.id);
  const ch = new Channel<ChatEvent>();
  ch.onmessage = (ev) => onEvent(pane.id, token, ev);
  try {
    const r = await ipc.chatSpawn({ paneId: pane.id, cwd: pane.cwd, account: pane.account, env: pane.env, secretEnv: pane.secretEnv, resume, resumeAt: resume ? branch?.at : undefined, fork: !!resume && fork, model: real(chatPicks(pane).model),
      effort: oc ? undefined : real(chatPicks(pane).effort),
      permissionMode: oc ? undefined : pane.chatPermission || startPermissionMode(getConfig().claudePermissionMode),
      provider: pane.provider,
      onEvent: ch,
    });
    if (spawns.get(pane.id) !== token) return;
    const first = firstMessage.get(pane.id);
    firstMessage.delete(pane.id);
    if (first) sendChat(pane.id, first.text, first.att);
    if (oc) return patch(pane.id, (s) => ({ ...s, status: s.status === "starting" ? "idle" : s.status }));
    void refreshContext(pane.id);
    ipc
      .chatCommands(pane.id)
      .then((r) => {
        patch(pane.id, (s) => ({ ...s, commands: (r.commands ?? []).filter((c) => !c.name.startsWith("_")), models: r.models, styles: r.styles, style: r.style }));
        // A style picked for this chat goes back on with the first message after a restart.
        const style = useLayout.getState().panes[pane.id]?.chatStyle;
        if (style && style !== r.style) configPending.set(pane.id, { ...configPending.get(pane.id), style });
      })
      .catch(() => {});
    patch(pane.id, (s) => ({
      ...s,
      status: s.status === "starting" ? "idle" : s.status,
      transcript: r.missingCwd ? addNotice(s.transcript, `${r.missingCwd} no longer exists, so this chat started elsewhere`, true) : s.transcript,
    }));
  } catch (e) {
    if (spawns.get(pane.id) === token) patch(pane.id, (s) => ({ ...s, status: "exited", transcript: addNotice(s.transcript, `Couldn't start ${agentName(pane)}: ${e}`, true) }));
  }
}

/**
 * Forks a chat (T3 Chat style): a new chat beside it continues a copy of the same
 * conversation (`--fork-session`), so both can go different ways.
 */
export function forkChat(paneId: string): string | null {
  const layout = useLayout.getState();
  const pane = layout.panes[paneId];
  // An OpenCode chat would carry on the same session, not a copy of it.
  if (!pane?.claudeSession || !chatCan(pane).fork) return null;
  const id = layout.splitPane(paneId, "row", { account: pane.account, cwd: pane.cwd, mode: "chat" });
  layout.updatePane(id, { claudeSession: pane.claudeSession, chatFork: true, chatUsed: true, chatModel: pane.chatModel, chatEffort: pane.chatEffort, chatPermission: pane.chatPermission });
  return id;
}

/** Chats about to restart as a branch: cut at `at` (the entry before message `before`). */
const branches = new Map<string, { at: string; before: string }>();

/**
 * Edit (or retry) an earlier message: the chat restarts on a copy of the conversation cut
 * just before it (Claude Code's --resume-session-at + --fork-session) and sends `text`
 * there. `undoFiles` first puts Claude's file changes from that message on back.
 */
export async function branchChat(paneId: string, uuid: string, text: string, undoFiles: boolean) {
  const pane = useLayout.getState().panes[paneId];
  if (!pane) return;
  try {
    if (undoFiles) await rewindChat(paneId, uuid, false);
    const parent = pane.claudeSession ? await ipc.chatParent(pane.account, pane.cwd ?? "", pane.claudeSession, uuid) : null;
    if (parent) branches.set(paneId, { at: parent, before: uuid });
    firstMessage.set(paneId, { text });
    // No parent: it was the first message, so the branch is a new chat.
    restartChat(paneId, !parent, true);
  } catch (e) {
    patch(paneId, (s) => ({ ...s, transcript: addNotice(s.transcript, `Couldn't edit that message: ${e}`, true) }));
  }
}

/** Starts the chat again after Claude stopped; `fresh` drops the old conversation. */
/** Stops the pane's Claude and ignores anything it still says; ensureChat starts it again. */
export function stopChat(paneId: string) {
  spawns.delete(paneId);
  return ipc.chatKill(paneId).catch(() => {});
}

export function restartChat(paneId: string, fresh = false, keepTotals = false) {
  void stopChat(paneId);
  if (fresh) useLayout.getState().updatePane(paneId, { claudeSession: undefined, ...(!keepTotals && { chatTokens: undefined, chatCost: undefined }) });
  const pane = useLayout.getState().panes[paneId];
  if (pane) ensureChat(pane);
}

/** Model and effort picks not yet sent to the running CLI: they go just before the next message. */
const configPending = new Map<string, { model?: string; effort?: string; style?: string }>();

/** The effort the running CLI was last switched to here, so auto effort only switches on a change. */
const appliedEffort = new Map<string, string>();

/** Picks as they stand: unset follows Settings → Auto effort ("auto") or the account's settings. */
export function chatPicks(pane: PaneMeta | undefined): { model: string; effort: string } {
  const cfg = getConfig().effort;
  const prefs = useUi.getState().prefs;
  // Auto model and effort are Claude's (src-tauri/src/effort.rs).
  if (isOpenCode(pane)) return { model: pane?.chatModel ?? "default", effort: "default" };
  return {
    model: pane?.chatModel ?? (prefs.newModel || (cfg?.autoModel ? "auto" : "default")),
    effort: pane?.chatEffort ?? (prefs.newEffort || (cfg?.auto === false ? "default" : "auto")),
  };
}

export const isOpenCode = (pane: PaneMeta | undefined) => pane?.provider === "opencode";

/** Who the chat runs, for its notices. */
export const agentName = (pane: PaneMeta | undefined) => (isOpenCode(pane) ? "OpenCode" : "Claude");

/** "auto" is ours: the CLI only ever gets a real model or level. */
const real = (v?: string) => (v === "auto" ? undefined : v);

export function setChatOptions(paneId: string, opts: { model?: string; effort?: string; style?: string }) {
  useLayout.getState().updatePane(paneId, {
    ...(opts.model !== undefined && { chatModel: opts.model }),
    ...(opts.effort !== undefined && { chatEffort: opts.effort }),
    ...(opts.style !== undefined && { chatStyle: opts.style }),
  });
  const next = { ...configPending.get(paneId), ...opts };
  if (next.model === "auto") delete next.model;
  if (next.effort === "auto") delete next.effort;
  configPending.set(paneId, next);
}

// One send at a time per pane: auto effort may wait on its judge, and a later message must not overtake.
const sending = new Map<string, Promise<void>>();

/**
 * Slash commands the chat answers itself, so its pickers stay the one place for model and
 * effort: `/model opus`, `/effort high`. `/clear` goes to Claude Code and empties the view.
 * Returns true when handled here.
 */
function localCommand(paneId: string, text: string): boolean {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const arg = rest.join(" ");
  if ((cmd === "/model" || cmd === "/effort") && arg) {
    setChatOptions(paneId, cmd === "/model" ? { model: arg } : { effort: arg });
    patch(paneId, (s) => ({ ...s, transcript: addNotice(s.transcript, `${cmd === "/model" ? "Model" : "Effort"}: ${arg}, from the next message`) }));
    return true;
  }
  return false;
}

/**
 * Undo from a message on: Claude Code puts the files it changed since then back (its own
 * checkpoints; the conversation stays). `dryRun` only says which files that would touch.
 */
export async function rewindChat(paneId: string, uuid: string, dryRun: boolean) {
  const r = await ipc.chatRewind(paneId, uuid, dryRun);
  if (!dryRun) patch(paneId, (s) => ({ ...s, transcript: addNotice(s.transcript, "Undid Claude's file changes from that message on") }));
  return r;
}

export function sendChat(paneId: string, text: string, att: Outgoing = {}, via?: SentVia) {
  const images = att.images ?? [];
  const documents = att.documents ?? [];
  if (!images.length && !documents.length && localCommand(paneId, text)) return Promise.resolve();
  if (!useLayout.getState().panes[paneId]?.chatUsed) useLayout.getState().updatePane(paneId, { chatUsed: true });
  const status = useChat.getState().byPane[paneId]?.status;
  const busy = status === "working" || status === "waiting";
  const msg: Queued = {
    text,
    images: images.map((i) => `data:${i.mediaType};base64,${i.data}`),
    ...(documents.length && { files: documents.map((d) => d.name) }),
    uuid: crypto.randomUUID(),
  };
  const uuid = msg.uuid;
  patch(paneId, (s) =>
    s.status === "working" || s.status === "waiting"
      ? { ...s, queued: [...s.queued, { ...msg, via: "queued" }] }
      : { ...s, status: "working", transcript: addUser(s.transcript, text, Date.now(), { ...msg, via }) },
  );
  const run = (sending.get(paneId) ?? Promise.resolve()).then(() => deliver(paneId, text, busy, images, documents, uuid));
  sending.set(paneId, run);
  return run;
}

async function deliver(paneId: string, text: string, busy: boolean, images: ChatImage[], documents: ChatDocument[], uuid: string) {
  try {
    // Switching mid-turn is untested ground: a message queued behind a running turn waits for the next one.
    if (!busy) {
      const oc = isOpenCode(useLayout.getState().panes[paneId]);
      const { model, effort, style } = { ...configPending.get(paneId), ...(oc ? {} : await autoPicks(paneId, text)) };
      configPending.delete(paneId);
      if (effort) appliedEffort.set(paneId, effort);
      if (model || effort || style) await ipc.chatConfigure(paneId, model, effort, style);
    }
    await ipc.chatSend(paneId, text, images.length ? images : undefined, uuid, documents.length ? documents : undefined);
    // Claude Code starts a new conversation (and session id); the view starts over with it.
    if (!busy && text.trim() === "/clear") patch(paneId, (s) => ({ ...s, transcript: addNotice(emptyTranscript(), "New conversation"), last: undefined }));
  } catch (e) {
    patch(paneId, (s) => ({ ...s, status: "exited", transcript: addNotice(s.transcript, `Couldn't send: ${e}`, true) }));
  }
}

/**
 * Auto model and auto effort for the message about to go (src-tauri/src/effort.rs: rules,
 * then a Haiku judge). The model is only picked for a chat's first message: switching later
 * throws the prompt cache away. Effort is picked per message on models where switching keeps
 * the cache (lib/effort.ts cacheSafe), and at the start, when there's no cache yet.
 */
async function autoPicks(paneId: string, text: string): Promise<{ model?: string; effort?: string }> {
  const pane = useLayout.getState().panes[paneId];
  const s = useChat.getState().byPane[paneId];
  if (!pane || !s) return {};
  const picks = chatPicks(pane);
  const fresh = !pane.claudeSession && s.transcript.items.filter((i) => i.kind === "user").length <= 1;
  const account = pane.account ?? null;
  const [m, e] = await Promise.all([
    picks.model === "auto" && fresh ? ipc.chooseModel(account, text).catch(() => null) : null,
    picks.effort === "auto" ? ipc.chooseEffort(account, text, getConfig().effort?.judge !== false).catch(() => null) : null,
  ]);
  const model = m?.model;
  const runs = model ?? s.model;
  const effort = e?.level && (fresh || cacheSafe(runs)) && e.level !== appliedEffort.get(paneId) ? e.level : undefined;
  if (m || e) {
    patch(paneId, (st) => ({
      ...st,
      auto: {
        model: m ? { pick: m.model, why: m.why } : st.auto?.model,
        effort: e ? { pick: e.level ?? appliedEffort.get(paneId), why: !fresh && !cacheSafe(runs) ? "kept: switching would lose the prompt cache on this model" : e.why } : st.auto?.effort,
      },
    }));
  }
  return { model, effort };
}

const contextLoading = new Set<string>();

/** Asks the chat's CLI what fills its context (`/context`), for the ring and its breakdown. */
export async function refreshContext(paneId: string) {
  if (contextLoading.has(paneId)) return;
  contextLoading.add(paneId);
  try {
    const context = await ipc.chatContextUsage(paneId);
    patch(paneId, (s) => ({ ...s, context, contextAt: Date.now() }));
  } catch {
    // An older CLI, or the chat stopped: the ring falls back to the last turn's usage.
  } finally {
    contextLoading.delete(paneId);
  }
}

/** Switches the chat's permission mode right away; the CLI confirms it with the new mode. */
export async function setChatMode(paneId: string, mode: string) {
  // OpenCode runs on its own permission rules: there is no mode to switch.
  if (!chatCan(useLayout.getState().panes[paneId]).mode) return;
  patch(paneId, (s) => ({ ...s, mode }));
  useLayout.getState().updatePane(paneId, { chatPermission: mode });
  await ipc.chatSetMode(paneId, mode).catch(() => {});
}

const isBusy = (paneId: string) => {
  const st = useChat.getState().byPane[paneId]?.status;
  return st === "working" || st === "waiting";
};

/**
 * Steer: stop the running turn, wait until it has really ended, then send. Sending while the interrupt is still in
 * flight would race it at the CLI and could mark the new turn as interrupted. After `timeoutMs` it sends anyway (queued).
 */
const steering = new Set<string>();
export async function steerChat(paneId: string, text: string, att: Outgoing = {}, timeoutMs = 5000) {
  // A second steer while one is stopping the turn joins it: it queues behind instead of interrupting again.
  if (steering.has(paneId)) return sendChat(paneId, text, att, "steered");
  steering.add(paneId);
  interruptChat(paneId);
  const t0 = Date.now();
  while (isBusy(paneId) && Date.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 60));
  steering.delete(paneId);
  return sendChat(paneId, text, att, "steered");
}

export function interruptChat(paneId: string) {
  ipc.chatInterrupt(paneId).catch(() => {});
}

export async function answerApproval(
  paneId: string,
  id: string,
  allow: boolean,
  always = false,
  input?: Record<string, unknown>,
  opts: { permissions?: unknown[]; message?: string } = {},
) {
  patch(paneId, (s) => ({ ...s, approvals: s.approvals.filter((a) => a.id !== id) }));
  // Answered: back to working (clears the waiting alert) unless more requests are queued.
  if (!useChat.getState().byPane[paneId]?.approvals.length)
    useAgents.getState().handle({ pane: paneId, event: "PostToolUse", configDir: "", ts: Date.now() / 1000, payload: {} });
  await ipc.chatAnswer(paneId, id, allow, always, input, opts.permissions, opts.message).catch(() => {});
}

/** The conversation as plain text, newest `lines` lines: what `aurelia_read_pane` returns for a chat. */
export function chatText(paneId: string, lines: number): string {
  const s = useChat.getState().byPane[paneId];
  if (!s) return "";
  const out: string[] = [];
  for (const i of s.transcript.items) {
    if (i.kind === "user") out.push(`> ${i.text}`);
    else if (i.kind === "text") out.push(i.text);
    else if (i.kind === "tool") out.push(`[${i.name}] ${toolSummary(i.name, i.input)}${i.isError ? " (failed)" : ""}`);
    else if (i.kind === "turn" && i.outcome !== "completed") out.push(`[${i.outcome}${i.error ? `: ${i.error}` : ""}]`);
    else if (i.kind === "notice") out.push(`[${i.text}]`);
  }
  for (const a of s.approvals) out.push(`[waiting for approval: ${a.tool} ${toolSummary(a.tool, a.input)}]`);
  return out.join("\n").split("\n").slice(-lines).join("\n");
}

/** Stops the pane's Claude and forgets its chat (the pane closed, or became a terminal). */
export function releaseChat(id: string) {
  if (!spawns.delete(id)) return;
  ipc.chatKill(id).catch(() => {});
  pending.delete(id);
  firstMessage.delete(id);
  configPending.delete(id);
  appliedEffort.delete(id);
  sending.delete(id);
  forkIds.delete(id);
  useChat.setState((st) => {
    const byPane = { ...st.byPane };
    delete byPane[id];
    return { byPane };
  });
}

onPanesClosed((ids) => ids.forEach(releaseChat));
