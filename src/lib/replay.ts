/**
 * Replay model (Theo, 2026-11-04 02:00: "fake model selections that have pre baked events ... so that an agent can run
 * a full end to end test without ever having to actually burn tokens").
 *
 * A recording is Claude Code JSON lines: stream-json output, or a session transcript cut down by
 * `scripts/replay-record.mjs`. Each prompt starts a turn; the turn's lines play back as the same `raw` events
 * src-tauri/src/chat.rs sends, so everything from the channel on (lib/chat.ts, the chat view) runs for real.
 */
import type { ChatEvent } from "./ipc.ts";

type Line = Record<string, any>;

export interface ReplayTurn {
  prompt: string;
  lines: Line[];
  result?: Line;
}

/** The person's own message: a user line with text, not a tool result or text Claude Code added. */
function isPrompt(l: Line): boolean {
  if (l.type !== "user" || l.isMeta || l.isSynthetic) return false;
  const c = l.message?.content;
  return typeof c === "string" || (Array.isArray(c) && c.some((x) => x?.type === "text") && !c.some((x) => x?.type === "tool_result"));
}

function promptText(l: Line): string {
  const c = l.message?.content;
  return typeof c === "string" ? c : c.filter((x: Line) => x?.type === "text").map((x: Line) => x.text).join("\n");
}

export function parseReplay(input: string | Line[]): ReplayTurn[] {
  const lines: Line[] = typeof input === "string"
    ? input.split("\n").flatMap((s) => {
        try {
          const v = JSON.parse(s);
          return v && typeof v === "object" ? [v] : [];
        } catch {
          return [];
        }
      })
    : input;
  const turns: ReplayTurn[] = [];
  // Lines before the first prompt (the init line) play with the first turn.
  let lead: Line[] = [];
  for (const l of lines) {
    if (isPrompt(l)) turns.push({ prompt: promptText(l), lines: lead.splice(0) });
    else if (!turns.length) lead.push(l);
    else if (l.type === "result") turns[turns.length - 1].result = l;
    else turns[turns.length - 1].lines.push(l);
  }
  return turns;
}

/** What chat.rs would send for this turn: working, each line, the turn's end, then idle. */
export function turnEvents(turn: ReplayTurn): ChatEvent[] {
  const r = turn.result;
  const u = r?.usage;
  const failed = !!r && (r.is_error || (typeof r.subtype === "string" && r.subtype !== "success"));
  return [
    { type: "status", status: "working" },
    ...turn.lines.map((msg): ChatEvent => ({ type: "raw", msg })),
    {
      type: "turnEnd",
      outcome: failed ? "failed" : "completed",
      error: failed ? (typeof r?.result === "string" ? r.result : r?.subtype ?? "failed") : null,
      durationMs: typeof r?.duration_ms === "number" ? r.duration_ms : null,
      usage: u
        ? {
            inputTokens: u.input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
            cacheReadTokens: u.cache_read_input_tokens ?? 0,
            cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
            costUsd: r?.total_cost_usd ?? 0,
          }
        : null,
    },
    { type: "status", status: "idle" },
  ];
}

const KEEP = new Set(["system", "user", "assistant", "result"]);

/** For the recorder: drop lines the chat view never reads, and write the home folder as `~`. */
export function sanitizeLine(l: Line, home: string): Line | null {
  if (!KEEP.has(l.type)) return null;
  if (!home) return l;
  return JSON.parse(JSON.stringify(l).split(home).join("~"));
}
