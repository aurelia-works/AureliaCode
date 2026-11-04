import type { ComponentType } from "react";
import type { Config } from "../../lib/ipc";
import { AboutSection } from "./AboutSection";
import { AccountsSection } from "./AccountsSection";
import { AgentsSection } from "./AgentsSection";
import { AppearanceSection } from "./AppearanceSection";
import { BrowserSection } from "./BrowserSection";
import { ChatSection } from "./ChatSection";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { EffortSection } from "./EffortSection";
import { GeneralSection } from "./GeneralSection";
import { HudSection } from "./HudSection";
import { IntegrationsSection } from "./IntegrationsSection";
import { MenubarSection } from "./MenubarSection";
import { MyAgentsSection } from "./MyAgentsSection";
import { RemoteSection } from "./RemoteSection";
import { RoutinesSection } from "./RoutinesSection";
import { ShortcutsSection } from "./ShortcutsSection";
import { SoundsSection } from "./SoundsSection";
import { ThreadsSection } from "./ThreadsSection";
import { PlannerSection } from "./PlannerSection";
import { ProvidersSection } from "./ProvidersSection";
import { SkillsSection } from "./SkillsSection";
import { SubagentsSection } from "./SubagentsSection";
import { SuggestionsSection } from "./SuggestionsSection";
import { UsageSection } from "./UsageSection";
import { VoiceSection } from "./VoiceSection";
import { WorktreesSection } from "./WorktreesSection";

/** Props every section receives. `draft` is the unsaved config; mutate it via `update`. */
export interface SectionProps {
  draft: Config;
  update(fn: (c: Config) => void): void;
  /** Status line in the page footer. */
  notify(msg: string): void;
}

export interface SettingsSection {
  id: string;
  label: string;
  /** Nav group; sections in the same group sit together. */
  group: string;
  /** Extra words the settings search should match. */
  keywords: string;
  Component: ComponentType<SectionProps>;
}

/** Adding a settings section = one entry here plus its component file. */
export const SECTIONS: SettingsSection[] = [
  { id: "general", label: "General", group: "App", keywords: "workspace folder editor permissions restore resume keep alive notifications prompt cache", Component: GeneralSection },
  { id: "appearance", label: "Appearance", group: "App", keywords: "theme palette dark light system terminal font contrast chat width motion animation", Component: AppearanceSection },
  { id: "chat", label: "Chat", group: "App", keywords: "send enter command enter queue steer follow-up timestamps messages", Component: ChatSection },
  { id: "sounds", label: "Sounds", group: "App", keywords: "sound volume notification alert", Component: SoundsSection },
  { id: "accounts", label: "Accounts", group: "App", keywords: "claude account config folder default workspace", Component: AccountsSection },
  { id: "my-agents", label: "My agents", group: "Agents", keywords: "agents teams custom", Component: MyAgentsSection },
  { id: "skills", label: "Skills", group: "Agents", keywords: "skills installed folders", Component: SkillsSection },
  { id: "providers", label: "Providers", group: "Agents", keywords: "providers installed signed in sign-in login models capabilities claude opencode gemini grok codex cursor copilot cli", Component: ProvidersSection },
  { id: "agents", label: "Agent keys", group: "Agents", keywords: "keys api key deepseek anthropic openai", Component: AgentsSection },
  { id: "effort", label: "Auto effort", group: "Agents", keywords: "model effort auto judge", Component: EffortSection },
  { id: "subagents", label: "Subagents", group: "Agents", keywords: "deepseek opencode model timeout", Component: SubagentsSection },
  { id: "suggestions", label: "Suggestions", group: "Agents", keywords: "provider ollama gemini openrouter", Component: SuggestionsSection },
  { id: "routines", label: "Routines", group: "Agents", keywords: "scheduled tasks cron daily", Component: RoutinesSection },
  { id: "threads", label: "Threads & keys", group: "Workspace", keywords: "undo pin drag background stash no project steer palette pr copy title prompt links drop files back forward", Component: ThreadsSection },
  { id: "browser", label: "Browser", group: "Workspace", keywords: "links local system search engine duckduckgo google bing", Component: BrowserSection },
  { id: "worktrees", label: "Worktrees", group: "Workspace", keywords: "git worktree branch default cleanup", Component: WorktreesSection },
  { id: "planner", label: "Planner", group: "Workspace", keywords: "goals habits signals briefing roadmap weekly", Component: PlannerSection },
  { id: "remote", label: "Remote", group: "Connections", keywords: "phone tailscale port lan", Component: RemoteSection },
  { id: "hud", label: "HUD", group: "Connections", keywords: "hud overlay", Component: HudSection },
  { id: "menubar", label: "Menu bar", group: "Connections", keywords: "tray squid menubar spend bill streamer blur privacy admin key", Component: MenubarSection },
  { id: "integrations", label: "Integrations", group: "Connections", keywords: "discord push ntfy", Component: IntegrationsSection },
  { id: "voice", label: "Voice", group: "Connections", keywords: "dictation microphone cleanup", Component: VoiceSection },
  { id: "shortcuts", label: "Shortcuts", group: "System", keywords: "keys keyboard", Component: ShortcutsSection },
  { id: "usage", label: "Usage", group: "System", keywords: "usage limits five hour week reset tokens", Component: UsageSection },
  { id: "diagnostics", label: "Diagnostics", group: "System", keywords: "version webview paths database logs", Component: DiagnosticsSection },
  { id: "about", label: "About", group: "System", keywords: "version github release license", Component: AboutSection },
];
