/** What a thread told a sub-agent (Theo, 2026-11-04 04:29: "I can't show them in the UI and learn from them").
 *  Claude's Task/Agent calls and OpenCode's `task` tool carry the prompt in plain text. A provider that encrypts it
 *  gives `prompt: null`, so the UI can say it was hidden instead of showing nothing. */

export const PROMPT_HIDDEN = "Prompt hidden by the provider";

export interface AgentPrompt {
  agent?: string;
  model?: string;
  /** null: the provider sent it encrypted. */
  prompt: string | null;
}

const AGENT_TOOLS = new Set(["task", "agent"]);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

export function agentPrompt(name: string, input: Record<string, unknown>): AgentPrompt | null {
  if (!AGENT_TOOLS.has(name.toLowerCase())) return null;
  const prompt = str(input.prompt);
  const hidden = !prompt && (str(input.encrypted_content) ?? str(input.encrypted_prompt));
  if (!prompt && !hidden) return null;
  return { agent: str(input.subagent_type), model: str(input.model), prompt: prompt ?? null };
}
