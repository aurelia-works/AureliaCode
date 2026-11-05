import { UndoToast } from "./components/UndoToast";
import { CaptureBox } from "./components/planner/CaptureBox";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { AccountPicker } from "./components/AccountPicker";
import { GridPicker } from "./components/GridPicker";
import { PromptFill } from "./components/PromptFill";
import { LayoutView } from "./components/LayoutView";
import { Navigator } from "./components/Navigator";
import { NoticeStack } from "./components/Notices";
import { PaneDragGhost } from "./components/PaneDrag";
import { RightPanel } from "./components/RightPanel";
import { ThreadHeader } from "./components/ThreadHeader";
import { TitleBar } from "./components/TitleBar";
import { Toast } from "./components/Toast";
import { fitAllTerminals, focusTerminal } from "./lib/terminals";
import { activeTab, useLayout } from "./store/layout";
import { useUi } from "./store/ui";

// Screens you open now and then load on first use, so the window shows sooner (`npm run perf`).
const screens = {
  weekly: () => import("./components/planner/WeeklyPage"),
  roadmap: () => import("./components/planner/RoadmapPage"),
  history: () => import("./components/HistoryPanel"),
  permissions: () => import("./components/PermissionsSheet"),
  agents: () => import("./components/AgentsBoard"),
  palette: () => import("./components/CommandPalette"),
  review: () => import("./components/DiffReview"),
  checkpoints: () => import("./components/Checkpoints"),
  settings: () => import("./components/settings/SettingsPage"),
  work: () => import("./components/WorkBoard"),
};
const WeeklyPage = lazy(() => screens.weekly().then((m) => ({ default: m.WeeklyPage })));
const RoadmapPage = lazy(() => screens.roadmap().then((m) => ({ default: m.RoadmapPage })));
const HistoryPanel = lazy(() => screens.history().then((m) => ({ default: m.HistoryPanel })));
const PermissionsSheet = lazy(() => screens.permissions().then((m) => ({ default: m.PermissionsSheet })));
const AgentsBoard = lazy(() => screens.agents().then((m) => ({ default: m.AgentsBoard })));
const CommandPalette = lazy(() => screens.palette().then((m) => ({ default: m.CommandPalette })));
const DiffReview = lazy(() => screens.review().then((m) => ({ default: m.DiffReview })));
const Checkpoints = lazy(() => screens.checkpoints().then((m) => ({ default: m.Checkpoints })));
const SettingsPage = lazy(() => screens.settings().then((m) => ({ default: m.SettingsPage })));
const WorkBoard = lazy(() => screens.work().then((m) => ({ default: m.WorkBoard })));

/** Fetches every lazy screen once the app is idle, so the first open doesn't wait on a load. */
export function preloadScreens() {
  const go = () => Object.values(screens).forEach((load) => void load().catch(() => {}));
  if ("requestIdleCallback" in window) requestIdleCallback(go, { timeout: 3000 });
  else setTimeout(go, 1500);
}

/** Mounts its screen the first time it opens and keeps it mounted after, as it was before it loaded lazily. */
function OnceOpened({ open, children }: { open: boolean; children: ReactNode }) {
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  return seen || open ? <Suspense fallback={null}>{children}</Suspense> : null;
}

/**
 * Frame: title bar (where you are) / navigator · stage · queue rail / status bar (fleet + fuel).
 * Review and Settings are full pages over the stage; launcher, grid and palette are dialogs.
 */
export function App() {
  const tabs = useLayout((s) => s.tabs);
  const activeTabId = useLayout((s) => s.activeTabId);
  const agentPanelOpen = useUi((s) => s.agentPanelOpen);
  const nav = useUi((s) => s.nav);
  const navRight = useUi((s) => s.prefs.navRight);
  const single = useUi((s) => s.single);
  const railTab = useUi((s) => s.railTab);
  const railWidth = useUi((s) => s.railWidths[s.railTab]);
  const mode = useUi((s) => s.mode);
  const historyOpen = useUi((s) => s.historyOpen);
  const permissionsOpen = useUi((s) => s.permissionsOpen);
  const reviewOpen = useUi((s) => s.reviewOpen);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const paletteOpen = useUi((s) => s.paletteOpen);
  const roadmapOpen = useUi((s) => s.roadmapOpen);
  const weeklyOpen = useUi((s) => s.weeklyOpen);
  const checkpointsOpen = useUi((s) => !!s.checkpointsPaneId);
  const focusKey = useLayout((s) => `${s.activeTabId}:${s.tabs.find((t) => t.id === s.activeTabId)?.focusedPaneId}`);
  const modalOpen = useUi((s) => s.settingsOpen || s.captureOpen || s.roadmapOpen || s.weeklyOpen || !!s.accountPicker || s.gridOpen || s.reviewOpen || s.paletteOpen || s.historyOpen || s.permissionsOpen);

  // Below 760px the thread list is a drawer: fold it once on the way down, and let the title-bar toggle reopen it.
  useEffect(() => {
    let wasNarrow = false;
    const check = () => {
      const narrow = window.innerWidth < 760;
      if (narrow && !wasNarrow && useUi.getState().nav) useUi.getState().set({ nav: null });
      wasNarrow = narrow;
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Belt and braces: anything that resized while the board covered the stage refits on the way back.
  useEffect(() => {
    if (mode !== "terminals") return;
    const id = requestAnimationFrame(fitAllTerminals);
    return () => cancelAnimationFrame(id);
  }, [mode]);

  // Opening or closing a side column changes every pane's width.
  useEffect(() => {
    const id = requestAnimationFrame(fitAllTerminals);
    return () => cancelAnimationFrame(id);
  }, [nav, agentPanelOpen, railTab, railWidth, single, focusKey]);

  // Keyboard focus follows the focused pane.
  useEffect(() => {
    if (modalOpen || useUi.getState().mode !== "terminals") return;
    const id = requestAnimationFrame(() => {
      const pane = activeTab()?.focusedPaneId;
      if (!pane) return;
      if (useLayout.getState().panes[pane]?.launcher) {
        document.querySelector<HTMLElement>(`[data-pane-id="${pane}"] .start-screen textarea`)?.focus();
      } else if (useUi.getState().suggestPaneId !== pane && useUi.getState().composerPaneId !== pane) focusTerminal(pane);
    });
    return () => cancelAnimationFrame(id);
  }, [focusKey, modalOpen, mode]);

  return (
    <div className={`app mode-${mode}`}>
      <TitleBar />
      <div className={`frame${navRight ? " nav-right" : ""}`}>
        {nav && <Navigator view={nav} />}
        <main className="stage">
          <ThreadHeader />
          <div className={`tabs-area${mode !== "terminals" ? " mode-hidden" : ""}`}>
            {tabs.map((tab) => (
              <div key={tab.id} className={`tab-content${tab.id === activeTabId ? "" : " hidden"}`}>
                <LayoutView node={tab.root} zoom={single ? tab.focusedPaneId : undefined} />
              </div>
            ))}
          </div>
          {mode === "agents" && (
            <Suspense fallback={null}>
              <AgentsBoard />
            </Suspense>
          )}
          {mode === "work" && (
            <Suspense fallback={null}>
              <WorkBoard
                // The launch path stays where it is: Start opens the existing picker with the item
                // as its task. The owner wires that to the thread/worktree creation next.
                onStart={(item) =>
                  useUi.getState().set({ accountPicker: { target: "tab", task: { project: item.project, id: item.id, title: item.title } } })
                }
                onReview={(item) => {
                  if (item.paneId && useLayout.getState().panes[item.paneId]) useLayout.getState().focusPane(item.paneId);
                  useUi.getState().set({ reviewOpen: true });
                }}
              />
            </Suspense>
          )}
        </main>
        {agentPanelOpen && mode === "terminals" && <RightPanel />}
      </div>
      <OnceOpened open={reviewOpen}>
        <DiffReview />
      </OnceOpened>
      <OnceOpened open={settingsOpen}>
        <SettingsPage />
      </OnceOpened>
      <AccountPicker />
      <GridPicker />
      <OnceOpened open={paletteOpen}>
        <CommandPalette />
      </OnceOpened>
      {historyOpen && (
        <Suspense fallback={null}>
          <HistoryPanel />
        </Suspense>
      )}
      {permissionsOpen && (
        <Suspense fallback={null}>
          <PermissionsSheet />
        </Suspense>
      )}
      <CaptureBox />
      <OnceOpened open={roadmapOpen}>
        <RoadmapPage />
      </OnceOpened>
      <OnceOpened open={weeklyOpen}>
        <WeeklyPage />
      </OnceOpened>
      <PromptFill />
      <OnceOpened open={checkpointsOpen}>
        <Checkpoints />
      </OnceOpened>
      <NoticeStack />
      <Toast />
      <UndoToast />
      <PaneDragGhost />
    </div>
  );
}
