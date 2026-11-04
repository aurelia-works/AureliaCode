// AureliaBot: what the phone remote shows of the agents running on this Mac, and the checks on
// what it asks for. Pure (no Tauri, no stores) so it is tested in Node; lib/remote.ts wires it up.
//
// The Mac does the work; the phone sees each agent's status, conversation, goal and approval
// requests, answers them, sends messages, and starts new agents. It is reached only through the
// remote's own server (this Mac, the tailnet via `tailscale serve`, never Funnel: tailscale.rs).

/** One line of an agent's conversation as the phone shows it. */
export interface ConvItem {
  id: string;
  kind: "user" | "text" | "tool" | "turn" | "notice";
  text: string;
  /** Tool name, for kind "tool". */
  name?: string;
  failed?: boolean;
}

/** A tool call waiting for an answer in a chat pane. */
export interface BotApproval {
  id: string;
  tool: string;
  what?: string;
}

/** What a chat pane adds to its row on the phone. */
export interface BotChat {
  /** "working" | "waiting" | "idle" | "starting" | "exited" (lib/chat.ts ChatStatus). */
  status: string;
  model?: string;
  /** The provider's label, e.g. "Claude · work" or "OpenCode". */
  provider?: string;
  /** The last thing the agent said, one line. */
  last?: string;
  approvals: BotApproval[];
  /** Messages sent while it was busy, waiting for their turn. */
  queued: number;
  goal?: { text: string; round: number; max: number; last?: string };
  costUsd: number;
}

/** The shapes lib/chat.ts and lib/chatModel.ts keep, narrowed to what is read here. */
export type SourceItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "text" | "thinking"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: Record<string, unknown>; isError?: boolean }
  | { kind: "turn"; id: string; outcome: string; error?: string }
  | { kind: "notice"; id: string; text: string; error?: boolean };

export interface SourceChat {
  status: string;
  transcript: { items: SourceItem[] };
  approvals: { id: string; tool: string; input: Record<string, unknown> }[];
  queued: unknown[];
  model?: string;
  costUsd: number;
}

export interface SourceGoal {
  text: string;
  rounds: number;
  maxRounds: number;
  ended?: unknown;
  last?: { met: boolean; code?: number | null; tail?: string; score?: number | null };
}

/** Longest text a conversation line carries to the phone. */
export const MAX_TEXT = 2000;
/** How many conversation lines a watched agent sends. */
export const CONV_TAIL = 40;
/** A phone keeps watching an agent by asking again within this long. */
export const WATCH_MS = 45_000;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** The file, command or URL a tool call is about, for a one-line summary. */
export function toolWhat(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  for (const k of ["command", "file_path", "path", "url", "pattern", "description", "prompt"]) {
    const v = input[k];
    if (typeof v === "string" && v) return clip(oneLine(v), 300);
  }
  return undefined;
}

/** The newest `CONV_TAIL` lines of a conversation; thinking stays on the Mac. */
export function convTail(items: SourceItem[], tail = CONV_TAIL): ConvItem[] {
  const out: ConvItem[] = [];
  for (const i of items) {
    if (i.kind === "user" || i.kind === "text") {
      if (i.text.trim()) out.push({ id: i.id, kind: i.kind, text: clip(i.text, MAX_TEXT) });
    } else if (i.kind === "tool") out.push({ id: i.id, kind: "tool", name: i.name, text: toolWhat(i.input) ?? "", ...(i.isError && { failed: true }) });
    else if (i.kind === "turn" && i.outcome !== "completed") out.push({ id: i.id, kind: "turn", text: i.error ? `${i.outcome}: ${clip(i.error, 300)}` : i.outcome, failed: true });
    else if (i.kind === "notice") out.push({ id: i.id, kind: "notice", text: clip(i.text, 300), ...(i.error && { failed: true }) });
  }
  return out.slice(-tail);
}

/** A chat pane's row extras: status, last line, approvals and goal. */
export function chatSummary(s: SourceChat, goal?: SourceGoal, provider?: string): BotChat {
  let last: string | undefined;
  for (let k = s.transcript.items.length - 1; k >= 0; k--) {
    const i = s.transcript.items[k];
    if (i.kind === "text" && i.text.trim()) {
      last = clip(oneLine(i.text), 160);
      break;
    }
  }
  return {
    status: s.status,
    ...(s.model && { model: s.model }),
    ...(provider && { provider }),
    ...(last && { last }),
    approvals: s.approvals.map((a) => ({ id: a.id, tool: a.tool, ...(toolWhat(a.input) && { what: toolWhat(a.input) }) })),
    queued: s.queued.length,
    ...(goal &&
      !goal.ended && {
        goal: {
          text: clip(goal.text, 200),
          round: goal.rounds + 1,
          max: goal.maxRounds,
          ...(goal.last && { last: goal.last.met ? "met" : goal.last.tail ? clip(oneLine(goal.last.tail), 120) : `exit ${goal.last.code ?? "?"}` }),
        },
      }),
    costUsd: s.costUsd,
  };
}

/** Panes a phone still watches at `now`; old asks are dropped from `watch`. */
export function watching(watch: Map<string, number>, now: number): string[] {
  for (const [id, at] of watch) if (now - at > WATCH_MS) watch.delete(id);
  return [...watch.keys()];
}

/** A provider the phone can start an agent on, with its models; `disabled` says why it can't. */
export interface BotProvider {
  id: string;
  label: string;
  disabled?: string;
  models: { value: string; label: string }[];
}

/** Claude's model picks, as the desktop composer offers them. */
export const CLAUDE_MODELS = [
  { value: "default", label: "Default" },
  { value: "auto", label: "Auto" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

/** Providers for the phone's "new agent" sheet: Claude per account, then the others that chat. */
export function botProviders(list: { id: string; provider: string; label: string; models: string[]; why: string | null }[]): BotProvider[] {
  return list.map((p) => ({
    id: p.id,
    label: p.label,
    ...(p.why && { disabled: p.why }),
    models: p.provider === "claude" ? CLAUDE_MODELS : [{ value: "default", label: "Default" }, ...p.models.slice(0, 40).map((m) => ({ value: m, label: m.slice(m.indexOf("/") + 1) }))],
  }));
}

/** What the phone may ask for besides the terminal actions. */
export type BotAction =
  | { kind: "watch"; pane: string }
  | { kind: "say"; pane: string; text: string }
  | { kind: "stop"; pane: string }
  | { kind: "approve"; pane: string; id: string; allow: boolean; always?: boolean }
  | { kind: "spawn"; provider: string; model?: string; cwd: string; prompt: string; nonce: string };

/** Longest message or task a phone can send. */
export const MAX_PROMPT = 20_000;

/**
 * Checks an action from the phone against what the Mac has: the pane must be a chat, an answer
 * must be for a request that is still open, a new agent must start in a folder the phone was
 * offered and on a provider that can chat. Returns why not, or null when it can run.
 */
export function refuse(
  a: BotAction,
  have: { chats: Record<string, SourceChat | undefined>; folders: string[]; providers: BotProvider[] },
): string | null {
  if (a.kind === "spawn") {
    if (!have.folders.includes(a.cwd)) return "unknown folder";
    const p = have.providers.find((x) => x.id === a.provider);
    if (!p) return "unknown provider";
    if (p.disabled) return p.disabled;
    if (a.model && !p.models.some((m) => m.value === a.model)) return "unknown model";
    if (typeof a.prompt !== "string" || !a.prompt.trim()) return "empty task";
    if (a.prompt.length > MAX_PROMPT) return "task too long";
    return null;
  }
  const chat = have.chats[a.pane];
  if (!chat) return "not a chat";
  if (a.kind === "say") return typeof a.text !== "string" || !a.text.trim() ? "empty message" : a.text.length > MAX_PROMPT ? "message too long" : null;
  if (a.kind === "approve") return chat.approvals.some((x) => x.id === a.id) ? null : "request already answered";
  return null;
}

/** A StatusGlyph state from a chat's own status, for a chat pane the agent tracker hasn't seen. */
export function chatVisual(status: string): string {
  return status === "waiting" ? "needs_input" : status === "working" || status === "starting" ? status : "idle";
}
