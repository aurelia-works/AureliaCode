import type { AgentSession, AgentStatus } from "../store/agents";

/**
 * What a pane looks like to the user: the hook status plus "finished and you haven't
 * looked yet" (attention on an idle session), which the board and rail treat as its own state.
 */
export type Visual = AgentStatus | "done";

export function visualOf(s: AgentSession): Visual {
  if (s.status === "idle" && s.attention) return "done";
  return s.status;
}

export const stateLabel: Record<Visual, string> = {
  needs_input: "needs you",
  working: "working",
  done: "finished",
  idle: "idle",
  starting: "starting",
};

/** Lower sorts first: who needs you, then unseen results, then work in flight. */
export const urgency: Record<Visual, number> = { needs_input: 0, done: 1, working: 2, starting: 3, idle: 4 };

/** One line-icon per state, one stroke weight (the T3/lucide family): the shape says the state
 *  as well as the colour, so it reads without colour too. */
const PATHS: Record<Visual | "shell", React.ReactNode> = {
  needs_input: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.3-2.4 2.3" />
      <path d="M12 16.5h.01" />
    </>
  ),
  working: <circle cx="12" cy="12" r="9" strokeDasharray="4.2 3.1" />,
  starting: <circle cx="12" cy="12" r="9" strokeDasharray="2 3.6" />,
  done: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.8" />
    </>
  ),
  idle: <circle cx="12" cy="12" r="9" />,
  shell: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="m8 10 2 2-2 2M12.5 14.5H16" />
    </>
  ),
};

/** The word a row shows beside the icon, so the state is not only a shape. */
export const stateWord: Record<Visual, string> = { needs_input: "Needs you", working: "Working", done: "Finished", idle: "Idle", starting: "Starting" };

/** A thread's state as one icon, optionally with its word ("Working", "Needs you"). */
export function StatusGlyph({ state, busy, title, word, decorative }: { state: Visual | "shell"; busy?: boolean; title?: string; word?: boolean; decorative?: boolean }) {
  const label = title ?? (state === "shell" ? (busy ? "shell, running a command" : "shell") : stateLabel[state]);
  const named = !decorative && !word;
  const icon = (
    <svg className={`glyph ${state}${busy ? " busy" : ""}`} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role={named ? "img" : undefined} aria-label={named ? label : undefined} aria-hidden={named ? undefined : true}>
      {named && <title>{label}</title>}
      {PATHS[state]}
    </svg>
  );
  if (!word || state === "shell") return icon;
  return (
    <span className={`status-word ${state}`}>
      {icon}
      <span className="state-text">{stateWord[state]}</span>
    </span>
  );
}
