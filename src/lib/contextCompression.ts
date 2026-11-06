/**
 * Opt-in long-session compression for new Claude Code threads (billion-context).
 * The backend owns the process. This module owns the wording and the per-thread stamp
 * so a settings change never rewrites a thread that is already open.
 */

export interface CompressionFacts {
  /** absent: nothing installed. unavailable: files are there but a launch would be refused. ready: a new thread can start the proxy. */
  phase: "absent" | "unavailable" | "ready";
  version: string | null;
  reason: string | null;
  claude: boolean;
  active: { paneId: string; account: string }[];
  failures: { paneId: string; account: string; code: number }[];
}

/** What a new thread records. Absent means this thread stays on plain Claude Code. */
export function compressionStamp(account: string | undefined, enabled: readonly string[] | undefined): true | undefined {
  if (!account || !enabled?.includes(account)) return undefined;
  return true;
}

type StampPane = {
  contextCompression?: boolean;
  chatUsed?: boolean;
  claudeSession?: string;
  provider?: string;
};

/**
 * A thread that has not started takes the account's switch when that account is chosen
 * (the start screen does this after the pane exists). A thread that already ran keeps
 * its stamp, including off. OpenCode never carries one.
 */
export function compressionForUpdate(pane: StampPane, patch: { account?: string; provider?: string; contextCompression?: boolean }, enabled: readonly string[] | undefined): boolean | undefined {
  if (patch.contextCompression !== undefined) return patch.contextCompression;
  if ((patch.provider ?? pane.provider) === "opencode") return undefined;
  if (pane.chatUsed || pane.claudeSession) return pane.contextCompression;
  if (patch.account) return compressionStamp(patch.account, enabled);
  return pane.contextCompression;
}

/**
 * Product description. Third-party cache-hit figures are not repeated here: this app has
 * not measured them. Compression stores summaries, so recall is not exact.
 */
export const COMPRESSION_SUMMARY =
  "A loopback proxy forwards a new Claude Code thread to your existing Claude provider and stores compressed summaries on this Mac. The model is still Claude. The context window stays finite, and older turns are summaries, so recall is not exact and this is not a local model.";

export interface CompressionCopy {
  summary: string;
  status: string;
  tone: "idle" | "ok" | "warn" | "bad";
  perAccount: Record<string, string>;
}

const names = (xs: string[]) => (xs.length ? xs.join(", ") : "no account");

/** Sentences for Settings. `enabled` is the account list in the draft, not a running process. */
export function compressionCopy(facts: CompressionFacts | null, enabled: readonly string[], accounts: readonly string[]): CompressionCopy {
  const on = accounts.filter((a) => enabled.includes(a));
  const perAccount: Record<string, string> = {};
  for (const a of accounts) {
    if (!enabled.includes(a)) perAccount[a] = "Off";
    else if (facts?.active.some((s) => s.account === a)) perAccount[a] = "Compressing";
    else if (facts?.failures.some((s) => s.account === a)) perAccount[a] = "Failed";
    else if (!facts || facts.phase === "absent") perAccount[a] = "On · install first";
    else if (facts.phase === "unavailable") perAccount[a] = "On · unavailable";
    else perAccount[a] = "On · no proxy";
  }
  if (!facts) {
    return { summary: COMPRESSION_SUMMARY, status: "Checking the install…", tone: "idle", perAccount };
  }
  if (facts.phase === "absent") {
    return {
      summary: COMPRESSION_SUMMARY,
      status: "Not installed. New threads stay on plain Claude Code until you install it.",
      tone: "idle",
      perAccount,
    };
  }
  if (facts.phase === "unavailable") {
    return {
      summary: COMPRESSION_SUMMARY,
      status: `Installed, but unavailable. ${facts.reason ?? "The install can't launch."} A thread with compression on will not start.`,
      tone: "bad",
      perAccount,
    };
  }
  const version = facts.version ? `Installed ${facts.version}.` : "Installed.";
  if (!on.length) {
    return {
      summary: COMPRESSION_SUMMARY,
      status: `${version} Off for every account. No compression proxy is running.`,
      tone: "ok",
      perAccount,
    };
  }
  if (facts.active.length) {
    const who = [...new Set(facts.active.map((s) => s.account))].join(", ");
    return {
      summary: COMPRESSION_SUMMARY,
      status: `${version} Compressing ${facts.active.length} new thread${facts.active.length === 1 ? "" : "s"} for ${who}. The proxy is on this Mac and forwards to your existing Claude provider.`,
      tone: "ok",
      perAccount,
    };
  }
  if (facts.failures.length) {
    const code = facts.failures[0]?.code;
    return {
      summary: COMPRESSION_SUMMARY,
      status: `${version} On for ${names(on)}. The last compressed thread stopped${code ? ` (exit ${code})` : ""} and was not left on plain Claude. Start a new thread to try again.`,
      tone: "bad",
      perAccount,
    };
  }
  return {
    summary: COMPRESSION_SUMMARY,
    status: `${version} On for ${names(on)}. No active compression proxy. The next new thread for ${names(on)} will start one.`,
    tone: "warn",
    perAccount,
  };
}

/** What a status poll is allowed to do next. Observation never starts a process. */
export function afterObserve(): "none" {
  return "none";
}
