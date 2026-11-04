// Delegated agent runs (aurelia_delegate, aurelia_delegation, deepseek_agent) read back from
// their tool calls, for the card the chat shows in place of a plain tool line. The Rust side
// (subagents::render) ends every report with a footer this parses. Pure, for `node --test`.

export type DelegationTool = "delegate" | "delegation" | "deepseek";

export interface Delegation {
  tool: DelegationTool;
  /** running: the call hasn't returned. background: started without waiting. status: a progress line. */
  state: "running" | "background" | "status" | "done" | "failed";
  id?: string;
  /** "DeepSeek", "OpenCode", "Claude", "Grok". */
  who?: string;
  provider?: string;
  model?: string;
  mode: "read" | "work";
  task?: string;
  tools?: number;
  secs?: number;
  session?: string;
  changed: string[];
  blocked: string[];
  stopped?: string;
  /** The agent's report without the footer. */
  report?: string;
}

/** Which delegation tool an MCP tool name is, or null. Names arrive as mcp__<server>__<tool>. */
export function delegationTool(name: string): DelegationTool | null {
  const tool = name.replace(/^mcp__.+?__/, "");
  return tool === "aurelia_delegate" ? "delegate" : tool === "aurelia_delegation" ? "delegation" : tool === "deepseek_agent" ? "deepseek" : null;
}

const FOOTER = /^(.+?) agent · (.+?) · (read-only|write) · (\d+) tool calls? · ([\d.]+)s(?: · session (\S+))?$/;
const WHO: Record<string, string> = { opencode: "OpenCode", claude: "Claude", grok: "Grok" };

export function parseDelegation(name: string, input: Record<string, unknown>, result: string | undefined, isError?: boolean): Delegation | null {
  const tool = delegationTool(name);
  if (!tool) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const provider = tool === "deepseek" ? "opencode" : str(input.provider);
  const tasks = Array.isArray(input.tasks) ? input.tasks.filter((t): t is string => typeof t === "string") : [];
  const d: Delegation = {
    tool,
    state: "running",
    provider,
    model: str(input.model),
    who: tool === "deepseek" ? "DeepSeek" : provider ? WHO[provider] : undefined,
    mode: input.mode === "work" || input.mode === "write" ? "work" : "read",
    task: str(input.task) ?? (tasks.length ? tasks.join("\n") : undefined),
    id: str(input.id),
    changed: [],
    blocked: [],
  };
  if (result === undefined) return d;
  const started = result.match(/^Started (d\d+): (.+?) agent on "(.*)"/);
  if (started) return { ...d, state: "background", id: started[1], who: started[2], task: d.task ?? started[3] };
  // A cancel replies "Cancelled dN." over the stopped run's report.
  const cancelled = result.match(/^Cancelled d\d+\.\n\n/);
  if (cancelled) result = result.slice(cancelled[0].length);
  const cut = result.lastIndexOf("\n\n---\n");
  if (cut < 0) {
    // A status line, a "still running" wait, or an error before any run.
    return { ...d, state: isError ? "failed" : "status", report: result.trim() };
  }
  const out: Delegation = { ...d, state: isError || cancelled ? "failed" : "done", report: result.slice(0, cut).trim() };
  for (const line of result.slice(cut + 5).split("\n")) {
    const f = line.match(FOOTER);
    if (f) {
      Object.assign(out, { who: f[1], model: f[2], mode: f[3] === "write" ? "work" : "read", tools: Number(f[4]), secs: Number(f[5]), session: f[6] });
    } else if (line.startsWith("Changed: ")) out.changed = line.slice(9).split(", ").filter(Boolean);
    else if (line.startsWith("Blocked: ")) out.blocked = line.slice(9).split("; ").filter(Boolean);
    else if (line.startsWith("Stopped: ")) out.stopped = line.slice(9);
    else if (line.startsWith("Delegation ")) out.id = line.slice(11).trim();
  }
  if (out.report === "(The agent returned no report.)") out.report = undefined;
  return out;
}
