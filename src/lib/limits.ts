import { useAgents, type AgentEvent } from "../store/agents";
import { useConfig } from "../store/config";
import { useLayout } from "../store/layout";
import { alertUser, type NoticeAction } from "../store/notifications";
import { useUsage } from "../store/usage";
import type { Usage } from "./ipc";
import { switchAccount } from "./handoff";
import { fallbackLabel, parseFallback, usableFallback, type Fallback } from "./fallback";
import { ipc } from "./ipc";
import { queueFirstMessage, useChat } from "./chat";
import { useUi } from "../store/ui";

/**
 * Continue a limited thread on the fallback from Settings → New threads. Another Claude account
 * takes the conversation itself; another provider (OpenCode) gets a new thread in the same
 * folder, seeded with the recent conversation, since a transcript can't cross providers.
 */
export async function continueOnFallback(paneId: string, f: Fallback) {
  const layout = useLayout.getState();
  const pane = layout.panes[paneId];
  if (!pane) return;
  if (f.provider === "claude") {
    if (await switchAccount(paneId, f.account)) layout.updatePane(paneId, { chatModel: f.model });
    return;
  }
  const path = useAgents.getState().sessions[paneId]?.transcriptPath;
  let recent = path ? await ipc.handoffSummary(path, 6000).catch(() => "") : "";
  if (!recent) {
    const said = (useChat.getState().byPane[paneId]?.transcript.items ?? []).flatMap((i) => (i.kind === "user" ? [`User: ${i.text}`] : []));
    recent = said.slice(-6).join("\n\n");
  }
  const id = layout.newTab({ mode: "chat", provider: "opencode", cwd: pane.cwd });
  layout.updatePane(id, { chatModel: f.model, title: pane.title });
  queueFirstMessage(
    id,
    "You are continuing work another agent started in this folder; its account hit its usage limit. " +
      "Here is the recent conversation; pick up where it left off without redoing finished work." +
      (recent ? `\n\n${recent}` : ""),
  );
}

/** Remaining room across both windows; null when we have no reading. */
export function headroom(u: Usage | null | undefined): number | null {
  if (!u) return null;
  const used = Math.max(u.fiveHour ?? 0, u.sevenDay ?? 0);
  return 100 - used;
}

/** The soonest reset among windows that are full, as a short clock time ("4:12 PM", "Fri 9:00 AM"). */
export function resetLabel(u: Usage | null | undefined): string {
  if (!u) return "";
  const full = [
    (u.fiveHour ?? 0) >= 100 ? u.fiveHourResetsAt : null,
    (u.sevenDay ?? 0) >= 100 ? u.sevenDayResetsAt : null,
  ]
    .map((iso) => (iso ? Date.parse(iso) : NaN))
    .filter((t) => !Number.isNaN(t));
  if (!full.length) return "";
  // Back only once every full window has reset.
  const at = new Date(Math.max(...full));
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return at.getTime() - Date.now() > 20 * 3600_000 ? `${at.toLocaleDateString([], { weekday: "short" })} ${time}` : time;
}

/** Other accounts that aren't limited, most headroom first. Unreadable usage ranks in the middle. */
export function alternatives(from: string): { name: string; room: number | null }[] {
  const { accounts } = useConfig.getState().config ?? { accounts: [] };
  const { usage } = useUsage.getState();
  return accounts
    .filter((a) => a.name !== from)
    .map((a) => ({ name: a.name, room: headroom(usage[a.name]) }))
    .filter((a) => a.room === null || a.room > 0)
    .sort((a, b) => (b.room ?? 50) - (a.room ?? 50));
}

/** In-app card for a pane whose account is out of room: continue the same thread elsewhere. */
export async function offerHandoff(paneId: string, message?: string) {
  const pane = useLayout.getState().panes[paneId];
  const from = pane?.account;
  if (!from) return;
  // Fresh numbers for both the reset time and the choice of target.
  await Promise.all(useConfig.getState().config!.accounts.map((a) => useUsage.getState().refresh(a.name, true)));
  const reset = resetLabel(useUsage.getState().usage[from]);
  const alts = alternatives(from);
  const fb = usableFallback(parseFallback(useUi.getState().prefs.fallback), from);
  const go = (name: string) => () => void switchAccount(paneId, name);
  const post = (names: string[], more: boolean) => {
    const actions: NoticeAction[] = names.map((n, i) => ({
      label: i === 0 && !more ? `Continue with ${n}` : n,
      tone: i === 0 && !more ? "primary" : undefined,
      run: go(n),
    }));
    if (more) actions.push({ label: "More…", run: () => (post(alts.map((a) => a.name), false), false) });
    // The fallback from Settings → New threads comes first, whichever provider it is on.
    if (fb) actions.unshift({ label: `Continue on ${fallbackLabel(fb)}`, tone: "primary", run: () => void continueOnFallback(paneId, fb) });
    if (fb && actions[1]?.tone === "primary") actions[1] = { ...actions[1], tone: undefined };
    actions.push({ label: "Wait", run: () => {} });
    alertUser({
      kind: "limit",
      key: `offer:${from}:${paneId}`,
      paneId,
      title: `${from} hit its limit${reset ? ` · resets ${reset}` : ""}`,
      body: fb
        ? fb.provider === "claude"
          ? `Keep this conversation going on your fallback, ${fallbackLabel(fb)}? The history moves with it.`
          : `Continue on your fallback, ${fallbackLabel(fb)}? It starts a new thread in this folder with the recent conversation.`
        : alts.length
          ? `Keep this conversation going on ${alts[0].name}? The history moves with it.`
          : (message?.slice(0, 160) || "Every other account is limited too."),
      actions: alts.length || fb ? actions : undefined,
    });
  };
  const names = alts.map((a) => a.name);
  post(names.slice(0, 2), names.length > 2);
}

/** Usage that is genuinely at the cap, as opposed to a transient 429. */
const LIMIT_TEXT = /usage limit|limit reached|hit your|limit will reset|resets? (at|in)/i;

/** A Claude turn died on an API error (StopFailure hook): offer a switch if it's the usage limit. */
export function onStopFailure(paneId: string, p: AgentEvent["payload"]) {
  const err = p.error ?? "";
  if (err !== "rate_limit" && err !== "billing_error") return;
  const text = `${p.error_details ?? ""} ${p.last_assistant_message ?? ""}`;
  const account = useLayout.getState().panes[paneId]?.account;
  const full = account ? (headroom(useUsage.getState().usage[account]) ?? 100) <= 0 : false;
  if (!LIMIT_TEXT.test(text) && !full) return;
  void offerHandoff(paneId, text.trim());
}

/** An account just reached 100%: every live Claude pane on it gets an offer. Returns how many. */
export function offerForAccount(account: string): number {
  const { panes } = useLayout.getState();
  const { sessions } = useAgents.getState();
  const ids = Object.keys(sessions).filter((id) => panes[id]?.account === account);
  ids.forEach((id) => void offerHandoff(id));
  return ids.length;
}
