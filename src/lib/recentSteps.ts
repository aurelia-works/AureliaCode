/**
 * A thread's last few tool steps as short past-tense lines, for the grid card's activity feed.
 * `failed` comes from a chat transcript's tool result; hook sessions only see PreToolUse, so
 * their steps never show as failed.
 */
export interface Step {
  id: string;
  text: string;
  failed: boolean;
}

type Item = { kind: string; id: string } & ({ kind: "tool"; name: string; input: Record<string, unknown>; isError?: boolean } | { kind: string });

const base = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const firstLine = (s: string) => s.split("\n")[0].trim().slice(0, 80);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

function phrase(name: string, input: Record<string, unknown>): string {
  let v: string | undefined;
  const file = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path);
  switch (name) {
    case "Read":
      return file ? `Read ${base(file)}` : "Read a file";
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return file ? `Edited ${base(file)}` : "Edited a file";
    case "Bash":
      return (v = str(input.command)) ? `Ran ${firstLine(v)}` : "Ran a command";
    case "Grep":
    case "Glob":
      return (v = str(input.pattern)) ? `Searched for ${firstLine(v)}` : "Searched";
    case "WebFetch":
    case "WebSearch":
      return (v = str(input.url)) ? `Fetched ${firstLine(v)}` : (v = str(input.query)) ? `Searched the web for ${firstLine(v)}` : "Looked on the web";
    case "Task":
    case "Agent":
      return (v = str(input.description)) ? `Delegated: ${firstLine(v)}` : "Delegated to a subagent";
    default:
      return `Used ${name}`;
  }
}

export function recentSteps(items: readonly Item[], n = 4): Step[] {
  const out: Step[] = [];
  for (const i of items) if (i.kind === "tool" && "name" in i) out.push({ id: i.id, text: phrase(i.name, i.input), failed: !!i.isError });
  return out.slice(-n);
}
