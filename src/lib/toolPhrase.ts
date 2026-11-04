/**
 * One line for a run of tool calls, the way a person would say it: "Ran 2 commands, edited
 * 3 files and 4 more". Commands, edits and agents lead; reads and searches come after. No
 * imports, so it runs under `node --test`.
 */

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

type Kind = { order: number; say: (n: number) => string; key?: (input: Record<string, unknown>) => unknown };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const path = (i: Record<string, unknown>) => i.file_path ?? i.notebook_path ?? i.path;

const KINDS: Record<string, Kind> = {
  command: { order: 0, say: (n) => `ran ${plural(n, "command")}` },
  edit: { order: 1, say: (n) => `edited ${plural(n, "file")}`, key: path },
  agent: { order: 2, say: (n) => `started ${plural(n, "agent")}` },
  read: { order: 3, say: (n) => `read ${plural(n, "file")}`, key: path },
  search: { order: 4, say: (n) => `searched ${plural(n, "time")}` },
  web: { order: 5, say: (n) => `looked up ${plural(n, "page")}` },
};

const KIND_OF: Record<string, string> = {
  Bash: "command",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  Task: "agent",
  Agent: "agent",
  Read: "read",
  Grep: "search",
  Glob: "search",
  WebFetch: "web",
  WebSearch: "web",
};

export function toolPhrase(tools: ToolCall[], max = 2): string {
  const counts = new Map<string, Set<unknown>>();
  let other = 0;
  tools.forEach((t, i) => {
    const kind = KIND_OF[t.name];
    if (!kind) return void other++;
    // Files count once however often they're touched; everything else counts each call.
    const id = KINDS[kind].key?.(t.input) ?? i;
    if (!counts.has(kind)) counts.set(kind, new Set());
    counts.get(kind)!.add(id);
  });
  const parts = [...counts].sort(([a], [b]) => KINDS[a].order - KINDS[b].order).map(([k, ids]) => ({ k, n: ids.size }));
  const shown = parts.slice(0, max).map(({ k, n }) => KINDS[k].say(n));
  const rest = parts.slice(max).reduce((n, p) => n + p.n, 0) + other;
  let line = shown.join(", ");
  if (rest) line = line ? `${line} and ${rest} more` : plural(rest, "tool");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** The same seed always picks the same entry, so a label doesn't change under the reader. */
export function pickBySeed<T>(list: readonly T[], seed: string): T {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  return list[Math.abs(h) % list.length];
}

const short = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const fileName = (p: unknown) => (typeof p === "string" && p ? p.split("/").filter(Boolean).pop() : undefined);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
function host(url: unknown) {
  try {
    return typeof url === "string" ? new URL(url).hostname.replace(/^www\./, "") : undefined;
  } catch {
    return undefined;
  }
}

/** Said when a tool's input names nothing to show; a few each, picked by the call's id. */
const BARE: Record<string, readonly string[]> = {
  command: ["Running a command", "At the shell", "Running it"],
  edit: ["Editing", "Making the change", "Writing the edit"],
  agent: ["Running an agent", "Handing it to an agent"],
  read: ["Reading", "Reading the file", "Looking through the file"],
  search: ["Searching", "Looking for matches", "Searching the code"],
  web: ["Reading the web", "Looking it up"],
  other: ["Working", "Using a tool"],
};
export const THINKING: readonly string[] = ["Thinking", "Thinking it through", "Working it out"];

/**
 * What a running tool call is doing, for the live line: "Reading Composer.tsx", "Searching
 * for u001d", the command's own description. `seed` (the call's id) picks the wording when
 * the input names nothing.
 */
export function liveToolLabel(t: ToolCall, seed: string): string {
  const i = t.input ?? {};
  const kind = KIND_OF[t.name] ?? "other";
  const bare = () => pickBySeed(BARE[kind], seed);
  switch (t.name) {
    case "Read": {
      const f = fileName(path(i));
      return f ? `Reading ${f}` : bare();
    }
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit": {
      const f = fileName(path(i));
      return f ? `Editing ${f}` : bare();
    }
    case "Write": {
      const f = fileName(path(i));
      return f ? `Writing ${f}` : bare();
    }
    case "Grep": {
      const p = text(i.pattern);
      return p ? `Searching for ${short(p, 32)}` : bare();
    }
    case "Glob": {
      const p = text(i.pattern);
      return p ? `Finding ${short(p, 32)}` : bare();
    }
    case "Bash": {
      const d = text(i.description);
      if (d) return short(d, 56);
      const cmd = text(i.command)?.split(/\s+/).slice(0, 2).join(" ");
      return cmd ? `Running ${short(cmd, 32)}` : bare();
    }
    case "WebFetch": {
      const h = host(i.url);
      return h ? `Reading ${h}` : bare();
    }
    case "WebSearch": {
      const q = text(i.query);
      return q ? `Searching the web for ${short(q, 32)}` : bare();
    }
    case "Task":
    case "Agent": {
      const d = text(i.description);
      return d ? `Agent: ${short(d, 48)}` : bare();
    }
  }
  // MCP tools arrive as mcp__server__tool_name.
  const mcp = t.name.match(/^mcp__[^_]+(?:_[^_]+)*?__(.+)$/)?.[1];
  if (mcp) return `Using ${mcp.replace(/_/g, " ")}`;
  return `Using ${t.name}`;
}
