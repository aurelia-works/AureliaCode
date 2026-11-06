/**
 * Settings, as data: the parts (one per old page, Threads & keys split three ways) and the
 * 10 sections that hold them. `components/settings/registry.ts` maps each part to its component.
 * Kept free of React so the search and the old-id links can be tested.
 */

export const PARTS = {
  general: { label: "General", keywords: "workspace folder editor restore resume keep alive notifications prompt cache" },
  browser: { label: "Browser", keywords: "links local system search engine duckduckgo google bing" },
  appearance: { label: "Appearance", keywords: "theme palette dark light system terminal font contrast chat width motion animation wordmark greeting hourly name" },
  "thread-view": { label: "Threads & grid", keywords: "thread list right grid status cards board signals background inbox alerts" },
  "new-threads": { label: "New threads", keywords: "model effort fallback provider limit opencode permissions permission mode start in claude panes plan bypass workspace worktree default new thread git branch cleanup" },
  effort: { label: "Auto effort", keywords: "model effort auto judge" },
  chat: { label: "Chat", keywords: "send enter command enter queue steer follow-up timestamps messages" },
  sounds: { label: "Sounds", keywords: "sound volume notification alert" },
  accounts: { label: "Accounts", keywords: "claude account config folder default workspace compression billion-context long session untangle" },
  providers: { label: "Providers", keywords: "providers installed signed in sign-in login models capabilities claude opencode gemini grok codex cursor copilot cli" },
  agents: { label: "Agent keys", keywords: "keys api key deepseek anthropic openai" },
  "my-agents": { label: "My agents", keywords: "agents teams custom" },
  skills: { label: "Skills", keywords: "skills installed folders" },
  subagents: { label: "Subagents", keywords: "deepseek opencode model timeout" },
  routines: { label: "Routines", keywords: "scheduled tasks cron daily" },
  review: { label: "Review & ready", keywords: "review council merge queue nightly human time" },
  remote: { label: "Remote", keywords: "phone tailscale port lan" },
  hud: { label: "HUD", keywords: "hud overlay" },
  menubar: { label: "Menu bar", keywords: "tray squid menubar spend bill streamer blur privacy admin key" },
  integrations: { label: "Integrations", keywords: "discord push ntfy" },
  voice: { label: "Voice", keywords: "dictation microphone cleanup" },
  undo: { label: "Undo & always-on", keywords: "undo pin drag background stash no project steer palette pr copy title prompt links drop files back forward keys" },
  suggestions: { label: "Suggestions", keywords: "provider ollama gemini openrouter" },
  planner: { label: "Planner", keywords: "goals habits signals briefing roadmap weekly" },
  labs: { label: "Labs", keywords: "labs experimental cosmetic jellyfish icons bloom start screen header chips branch cost mode account" },
  computer: { label: "Computer use", keywords: "computer desktop mouse keyboard screenshot accessibility screen recording permission control" },
  shortcuts: { label: "Shortcuts", keywords: "keys keyboard" },
  usage: { label: "Usage", keywords: "usage limits five hour week reset tokens" },
  diagnostics: { label: "Diagnostics", keywords: "version webview paths database logs" },
  about: { label: "About", keywords: "version github release license" },
} as const;

export type PartId = keyof typeof PARTS;

export interface SectionDef {
  id: string;
  label: string;
  /** Nav group; sections in the same group sit together. */
  group: string;
  parts: PartId[];
  /** Rarely used parts, under a folded "Advanced" block after the rest. */
  folded?: PartId[];
}

/** The B layout's 10 sections (approved on the review page, 2026-11-05). */
export const SECTION_DEFS: SectionDef[] = [
  { id: "general", label: "General", group: "App", parts: ["general", "browser"] },
  { id: "appearance", label: "Appearance", group: "App", parts: ["appearance", "thread-view"] },
  { id: "new-threads", label: "New threads", group: "App", parts: ["new-threads", "effort"] },
  { id: "chat", label: "Chat & alerts", group: "App", parts: ["chat", "sounds"] },
  { id: "accounts", label: "Accounts & providers", group: "AI", parts: ["accounts", "providers", "agents"] },
  { id: "agents", label: "Agents", group: "AI", parts: ["my-agents", "skills", "subagents"] },
  { id: "background", label: "Background", group: "AI", parts: ["routines", "review"] },
  { id: "connections", label: "Connections", group: "Devices", parts: ["remote", "hud", "menubar", "integrations", "voice"] },
  { id: "advanced", label: "Advanced & Labs", group: "System", parts: ["labs", "computer"], folded: ["undo", "suggestions", "planner"] },
  { id: "about", label: "About", group: "System", parts: ["about", "usage", "shortcuts", "diagnostics"] },
];

/** The 27 pages before 2026-11-05, kept so old links and the search test know where each went. */
export const OLD_SECTIONS: { id: string; label: string; keywords: string; to: string[] }[] = [
  { id: "general", label: "General", keywords: PARTS.general.keywords, to: ["general"] },
  { id: "appearance", label: "Appearance", keywords: "theme palette dark light system terminal font contrast chat width motion animation", to: ["appearance"] },
  { id: "new-threads", label: "New threads", keywords: PARTS["new-threads"].keywords, to: ["new-threads"] },
  { id: "chat", label: "Chat", keywords: PARTS.chat.keywords, to: ["chat"] },
  { id: "sounds", label: "Sounds", keywords: PARTS.sounds.keywords, to: ["chat"] },
  { id: "accounts", label: "Accounts", keywords: PARTS.accounts.keywords, to: ["accounts"] },
  { id: "my-agents", label: "My agents", keywords: PARTS["my-agents"].keywords, to: ["agents"] },
  { id: "skills", label: "Skills", keywords: PARTS.skills.keywords, to: ["agents"] },
  { id: "providers", label: "Providers", keywords: PARTS.providers.keywords, to: ["accounts"] },
  { id: "agents", label: "Agent keys", keywords: PARTS.agents.keywords, to: ["accounts"] },
  { id: "effort", label: "Auto effort", keywords: PARTS.effort.keywords, to: ["new-threads"] },
  { id: "subagents", label: "Subagents", keywords: PARTS.subagents.keywords, to: ["agents"] },
  { id: "suggestions", label: "Suggestions", keywords: PARTS.suggestions.keywords, to: ["advanced"] },
  { id: "routines", label: "Routines", keywords: PARTS.routines.keywords, to: ["background"] },
  {
    id: "threads",
    label: "Threads & keys",
    keywords: "undo pin drag background stash no project steer palette pr copy title prompt links drop files back forward thread list right grid status cards board signals review council merge queue nightly human time",
    to: ["appearance", "background", "advanced"],
  },
  { id: "browser", label: "Browser", keywords: PARTS.browser.keywords, to: ["general"] },
  { id: "planner", label: "Planner", keywords: PARTS.planner.keywords, to: ["advanced"] },
  { id: "remote", label: "Remote", keywords: PARTS.remote.keywords, to: ["connections"] },
  { id: "hud", label: "HUD", keywords: PARTS.hud.keywords, to: ["connections"] },
  { id: "menubar", label: "Menu bar", keywords: PARTS.menubar.keywords, to: ["connections"] },
  { id: "integrations", label: "Integrations", keywords: PARTS.integrations.keywords, to: ["connections"] },
  { id: "voice", label: "Voice", keywords: PARTS.voice.keywords, to: ["connections"] },
  { id: "shortcuts", label: "Shortcuts", keywords: PARTS.shortcuts.keywords, to: ["about"] },
  { id: "usage", label: "Usage", keywords: PARTS.usage.keywords, to: ["about"] },
  { id: "labs", label: "Labs", keywords: PARTS.labs.keywords, to: ["advanced"] },
  { id: "diagnostics", label: "Diagnostics", keywords: PARTS.diagnostics.keywords, to: ["about"] },
  { id: "about", label: "About", keywords: PARTS.about.keywords, to: ["about"] },
];

const partText = (p: PartId) => `${PARTS[p].label} ${PARTS[p].keywords}`;

/** What the search box matches for a section: its name, its parts' names and keywords, and the old pages it took in. */
function sectionText(s: SectionDef): string {
  const old = OLD_SECTIONS.filter((o) => o.to.includes(s.id)).map((o) => o.label);
  return [s.label, ...s.parts.map(partText), ...(s.folded ?? []).map(partText), ...old].join(" ").toLowerCase();
}

export function searchSections(query: string): SectionDef[] {
  const q = query.trim().toLowerCase();
  return q ? SECTION_DEFS.filter((s) => sectionText(s).includes(q)) : SECTION_DEFS;
}

/** True when the query matches one of the section's folded parts, so the fold opens. */
export function foldMatches(s: SectionDef, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !!q && (s.folded ?? []).some((p) => partText(p).toLowerCase().includes(q));
}

/** A section id from a link: new ids pass through, an old page's id opens the section that holds it. */
export function resolveSectionId(id: string | null | undefined): string {
  if (id && SECTION_DEFS.some((s) => s.id === id)) return id;
  const old = OLD_SECTIONS.find((o) => o.id === id);
  return old ? old.to[0] : SECTION_DEFS[0].id;
}
