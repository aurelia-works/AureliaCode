import { label, useAgents } from "../store/agents";
import { useLive } from "../store/live";
import { paneContext, price, useMetrics } from "../store/metrics";
import { useNotices } from "../store/notifications";
import { fullCard, FULL_BODY, handoffAdvice } from "./advice";
import { cacheState, cacheTtlFor } from "./cache";
import { handOff } from "./handoff";

/**
 * The context cards. One per thread once its context is nearly full, running or not: it follows
 * the real number and goes when the fact does (compacted, handed off, cleared). And, for an idle
 * thread, one when the cache went cold on a context big enough that the next message is
 * expensive (lib/advice.ts). Never a desktop alert.
 */
export function startHandoffAdvisor() {
  const full = new Set<string>();
  const cold = new Map<string, string>();
  setInterval(() => {
    const now = Date.now();
    const sessions = useAgents.getState().sessions;
    const live = useLive.getState().byPane;
    const metrics = useMetrics.getState().byPane;
    const notices = useNotices.getState();
    for (const id of full) {
      if (sessions[id]) continue;
      full.delete(id);
      notices.retire(`context:${id}`);
    }
    for (const id of cold.keys()) {
      if (sessions[id]) continue;
      cold.delete(id);
      notices.retire(`cold:${id}`);
    }
    for (const s of Object.values(sessions)) {
      const fill = paneContext(s.paneId);
      const key = `context:${s.paneId}`;
      const title = `${label(s)}: Context ${Math.round(fill?.pct ?? 0)}% full`;
      const card = fill ? fullCard(fill.pct, full.has(s.paneId)) : "none";
      if (card === "show") {
        full.add(s.paneId);
        notices.push({ kind: "context", key, paneId: s.paneId, title, body: FULL_BODY, sticky: true, actions: [{ label: "Hand off", tone: "primary", run: () => void handOff(s.paneId) }] });
      } else if (card === "update") notices.update(key, { title });
      else if (card === "clear") {
        full.delete(s.paneId);
        notices.retire(key);
      }

      const l = live[s.paneId];
      const m = metrics[s.paneId];
      const advice =
        s.status === "idle" && fill
          ? handoffAdvice({
              contextTokens: fill.tokens,
              contextWindow: fill.window,
              cacheCold: cacheState(s, now, cacheTtlFor(s.paneId), l).kind === "cold",
              inputPricePerMTok: price(l?.model ?? m?.model)[0],
            })
          : null;
      const coldKey = `cold:${s.paneId}`;
      if (advice?.reason !== "cold") {
        // The next message warmed it, or the thread went back to work.
        if (cold.delete(s.paneId)) notices.retire(coldKey);
        continue;
      }
      // Once per session and cache window.
      const stamp = `${s.sessionId}:${l?.cache?.expiresAt ?? s.lastRequestAt ?? ""}`;
      if (cold.get(s.paneId) === stamp) continue;
      cold.set(s.paneId, stamp);
      notices.push({
        kind: "cache",
        key: coldKey,
        paneId: s.paneId,
        title: `${label(s)}: ${advice.title}`,
        body: advice.body,
        sticky: true,
        actions: [{ label: "Hand off", tone: "primary", run: () => void handOff(s.paneId) }],
      });
    }
  }, 5000);
}
