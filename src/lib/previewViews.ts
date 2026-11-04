// Which preview-harness views (design/preview/?view=...) a set of changed files can affect.
// Used by scripts/preview-shots.mjs to pick the before/after screenshots for a PR.

/** A view query string, without the leading `?view=`. */
export type PreviewView = string;

/** Shown when a change touches shared styling or the app shell. */
export const CORE_VIEWS: PreviewView[] = ["threads", "chat", "start", "settings"];

/** Every view the harness knows, in the order screenshots are listed. */
export const ALL_VIEWS: PreviewView[] = [
  "threads", "threads&single=1", "threads&rail=changes", "chat", "start", "board", "work", "review",
  "settings", "settings&section=accounts", "palette", "files", "terminals", "permissions", "commit",
  "history", "agentview", "tray", "weekly", "roadmap",
];

// First match wins. Paths are repo-relative with forward slashes.
const RULES: [RegExp, PreviewView[]][] = [
  [/^src\/styles\/board\.css$/, ["board"]],
  [/^src\/styles\/agentview\.css$/, ["agentview"]],
  [/^src\/styles\/|^src\/App\.tsx$|^src\/main\.tsx$|^src\/components\/(Icons|TitleBar|StatusBar|Toast|UndoToast|Notices)\.tsx$|^src\/lib\/(theme|uiAppearance|palettes)\.ts$|^index\.html$|^design\/preview\//, CORE_VIEWS],
  [/^src\/components\/(ChatPane|Composer|SuggestBar|PromptFill|Checkpoints|SessionExtras|CacheBadge|UsageChip|UsageMeter)\.tsx$|^src\/lib\/(chat|chatModel|chatComposer|chatReplay|contextFill|toolPhrase|markdown|attachments)\.ts$/, ["chat"]],
  [/^src\/components\/ChangesPanel\.tsx$/, ["threads&rail=changes"]],
  [/^src\/components\/(ThreadPanel|ThreadHeader|QueueRail|DetailsPanel|RightPanel|Navigator|ProjectsSidebar|StatusGlyph|AgentChip|UsageStrip)\.tsx$|^src\/lib\/(threads|threadOrder|threadActions)\.ts$/, ["threads", "threads&single=1"]],
  [/^src\/components\/StartScreen\.tsx$|^src\/lib\/startMode\.ts$/, ["start"]],
  [/^src\/components\/AgentsBoard\.tsx$/, ["board"]],
  [/^src\/components\/WorkBoard\.tsx$|^src\/lib\/work\.ts$/, ["work"]],
  [/^src\/components\/DiffReview\.tsx$/, ["review"]],
  [/^src\/components\/(AccountPicker|AccountSwitch)\.tsx$|^src\/components\/settings\/AccountsSection\.tsx$/, ["settings&section=accounts"]],
  [/^src\/components\/settings\//, ["settings"]],
  [/^src\/components\/CommandPalette\.tsx$/, ["palette"]],
  [/^src\/components\/(FilesPanel|EditorPane|SearchPanel|ProblemsPanel)\.tsx$/, ["files"]],
  [/^src\/components\/(PaneView|LayoutView|PaneHeader|PaneDrag|GridPicker|BrowserPane)\.tsx$/, ["terminals"]],
  [/^src\/components\/PermissionsSheet\.tsx$/, ["permissions"]],
  [/^src\/components\/GitDialog\.tsx$/, ["commit"]],
  [/^src\/components\/HistoryPanel\.tsx$/, ["history"]],
  [/^src\/components\/AgentView\.tsx$/, ["agentview"]],
  [/^src\/tray\/|^src\/lib\/trayIcon\.ts$/, ["tray"]],
  [/^src\/components\/planner\/(WeeklyPage|HabitsPanel|TodayPanel|BriefingCard|SignalsRow|FocusChip|CaptureBox|NotesPanel)\.tsx$/, ["weekly"]],
  [/^src\/components\/planner\/RoadmapPage\.tsx$/, ["roadmap"]],
];

/** Views a change to these files can affect, deduped, in `ALL_VIEWS` order. Unknown files add nothing. */
export function viewsFor(files: string[]): PreviewView[] {
  const hit = new Set<PreviewView>();
  for (const raw of files) {
    const f = raw.replace(/\\/g, "/").replace(/^\.\//, "");
    if (f.endsWith(".test.ts")) continue;
    const rule = RULES.find(([re]) => re.test(f));
    for (const v of rule?.[1] ?? []) hit.add(v);
  }
  return ALL_VIEWS.filter((v) => hit.has(v));
}

/** A file-name-safe slug for a view, e.g. `settings&section=accounts` → `settings-section-accounts`. */
export function viewSlug(view: PreviewView): string {
  return view.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}
