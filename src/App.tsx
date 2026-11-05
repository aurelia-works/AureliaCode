import { UndoToast } from "./components/UndoToast";
import { CaptureBox } from "./components/planner/CaptureBox";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
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
import { WorkerSheet } from "./components/WorkerSheet";
import { gridFits } from "./lib/gridFit";
import { fitAllTerminals, focusTerminal } from "./lib/terminals";
import { activeTab, useLayout } from "./store/layout";
import { useUi } from "./store/ui";

// Screens you open now and then load on first use, so the window shows sooner (`npm run perf`).
// Not React.lazy: once a screen's code is in, it renders in the same frame instead of after
// Suspense's reveal delay, and the idle preload below makes even the first open immediate.
type Loaded<P> = ComponentType<P> | null;
function onDemand<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: Loaded<P> = null;
  const fetch = () => load().then((c) => (loaded = c));
  function Screen(props: P) {
    const [, rerender] = useState(0);
    useEffect(() => {
      if (!loaded) void fetch().then(() => rerender((n) => n + 1));
    }, []);
    const C = loaded;
    return C ? <C {...props} /> : null;
  }
  return Object.assign(Screen, { fetch });
}
const WeeklyPage = onDemand(() => import("./components/planner/WeeklyPage").then((m) => m.WeeklyPage));
const RoadmapPage = onDemand(() => import("./components/planner/RoadmapPage").then((m) => m.RoadmapPage));
const HistoryPanel = onDemand(() => import("./components/HistoryPanel").then((m) => m.HistoryPanel));
const PermissionsSheet = onDemand(() => import("./components/PermissionsSheet").then((m) => m.PermissionsSheet));
const AgentsBoard = onDemand(() => import("./components/AgentsBoard").then((m) => m.AgentsBoard));
const CommandPalette = onDemand(() => import("./components/CommandPalette").then((m) => m.CommandPalette));
const DiffReview = onDemand(() => import("./components/DiffReview").then((m) => m.DiffReview));
const Checkpoints = onDemand(() => import("./components/Checkpoints").then((m) => m.Checkpoints));
const SettingsPage = onDemand(() => import("./components/settings/SettingsPage").then((m) => m.SettingsPage));
const WorkBoard = onDemand(() => import("./components/WorkBoard").then((m) => m.WorkBoard));
const screens = [WeeklyPage, RoadmapPage, HistoryPanel, PermissionsSheet, AgentsBoard, CommandPalette, DiffReview, Checkpoints, SettingsPage, WorkBoard];

/** Loads every on-demand screen's code (the preview harness waits on it before screenshots). */
export const loadScreens = () => Promise.all(screens.map((s) => s.fetch()));

/** Fetches every on-demand screen once the app is idle, so the first open doesn't wait on a load. */
export function preloadScreens() {
  const go = () => void loadScreens().catch(() => {});
  if ("requestIdleCallback" in window) requestIdleCallback(go, { timeout: 3000 });
  else setTimeout(go, 1500);
}

/** Mounts its screen the first time it opens and keeps it mounted after, as it was before it loaded on demand. */
function OnceOpened({ open, children }: { open: boolean; children: ReactNode }) {
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  return seen || open ? children : null;
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
  // Stage width, for folding a grid that would squeeze its panes below PANE_MIN_WIDTH.
  const tabsArea = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  useEffect(() => {
    const el = tabsArea.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStageWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const activeRoot = tabs.find((t) => t.id === activeTabId)?.root;
  const folded = !single && !!activeRoot && !gridFits(activeRoot, stageWidth);
  useEffect(() => {
    if (useUi.getState().gridFolded !== folded) useUi.getState().set({ gridFolded: folded });
  }, [folded]);
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
  }, [nav, agentPanelOpen, railTab, railWidth, single, folded, focusKey]);

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
          <div ref={tabsArea} className={`tabs-area${mode !== "terminals" ? " mode-hidden" : ""}`}>
            {tabs.map((tab) => (
              <div key={tab.id} className={`tab-content${tab.id === activeTabId ? "" : " hidden"}`}>
                <LayoutView node={tab.root} zoom={single || (tab.id === activeTabId && folded) ? tab.focusedPaneId : undefined} />
              </div>
            ))}
          </div>
          {mode === "agents" && <AgentsBoard />}
          {mode === "work" && (
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
      {historyOpen && <HistoryPanel />}
      {permissionsOpen && <PermissionsSheet />}
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
      <WorkerSheet />
      <PaneDragGhost />
    </div>
  );
}
