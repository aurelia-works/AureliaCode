import type { ComponentType } from "react";
import type { Config } from "../../lib/ipc";
import { PARTS, SECTION_DEFS, sectionText, type PartId, type SectionDef } from "../../lib/settingsIndex";
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
import { LabsSection } from "./LabsSection";
import { MenubarSection } from "./MenubarSection";
import { MyAgentsSection } from "./MyAgentsSection";
import { NewThreadsSection } from "./NewThreadsSection";
import { RemoteSection } from "./RemoteSection";
import { RoutinesSection } from "./RoutinesSection";
import { ShortcutsSection } from "./ShortcutsSection";
import { SoundsSection } from "./SoundsSection";
import { ReviewSection, ThreadViewSection, UndoSection } from "./ThreadsSection";
import { PlannerSection } from "./PlannerSection";
import { ProvidersSection } from "./ProvidersSection";
import { SkillsSection } from "./SkillsSection";
import { SubagentsSection } from "./SubagentsSection";
import { SuggestionsSection } from "./SuggestionsSection";
import { UsageSection } from "./UsageSection";
import { VoiceSection } from "./VoiceSection";

/** Props every section receives. `draft` is the live config; `update` applies a change at once (⌘Z undoes it). */
export interface SectionProps {
  draft: Config;
  update(fn: (c: Config) => void): void;
  /** Status line in the page header. */
  notify(msg: string): void;
}

export interface SettingsSection extends SectionDef {
  /** Lowercase text the settings search matches. */
  text: string;
}

/** Each part of a section is one of the old pages' components. Adding a page = a part in settingsIndex.ts plus a row here. */
export const PART_COMPONENTS: Record<PartId, ComponentType<SectionProps>> = {
  general: GeneralSection,
  browser: BrowserSection,
  appearance: AppearanceSection,
  "thread-view": ThreadViewSection,
  "new-threads": NewThreadsSection,
  effort: EffortSection,
  chat: ChatSection,
  sounds: SoundsSection,
  accounts: AccountsSection,
  providers: ProvidersSection,
  agents: AgentsSection,
  "my-agents": MyAgentsSection,
  skills: SkillsSection,
  subagents: SubagentsSection,
  routines: RoutinesSection,
  review: ReviewSection,
  remote: RemoteSection,
  hud: HudSection,
  menubar: MenubarSection,
  integrations: IntegrationsSection,
  voice: VoiceSection,
  undo: UndoSection,
  suggestions: SuggestionsSection,
  planner: PlannerSection,
  labs: LabsSection,
  shortcuts: ShortcutsSection,
  usage: UsageSection,
  diagnostics: DiagnosticsSection,
  about: AboutSection,
};

export const partLabel = (p: PartId) => PARTS[p].label;

export const SECTIONS: SettingsSection[] = SECTION_DEFS.map((s) => ({ ...s, text: sectionText(s) }));
