import { UndoToast } from "./components/UndoToast";
import { WeeklyPage } from "./components/planner/WeeklyPage";
import { RoadmapPage } from "./components/planner/RoadmapPage";
import { CaptureBox } from "./components/planner/CaptureBox";
import { HistoryPanel } from "./components/HistoryPanel";
import { useEffect } from "react";
import { AccountPicker } from "./components/AccountPicker";
import { AgentsBoard } from "./components/AgentsBoard";
import { CommandPalette } from "./components/CommandPalette";
import { DiffReview } from "./components/DiffReview";
import { GridPicker } from "./components/GridPicker";
import { PromptFill } from "./components/PromptFill";
import { Checkpoints } from "./components/Checkpoints";
import { LayoutView } from "./components/LayoutView";
import { Navigator } from "./components/Navigator";
import { NoticeStack } from "./components/Notices";
import { PaneDragGhost } from "./components/PaneDrag";
import { RightPanel } from "./components/RightPanel";
import { SettingsPage } from "./components/settings/SettingsPage";
import { ThreadHeader } from "./components/ThreadHeader";
import { TitleBar } from "./components/TitleBar";
import { Toast } from "./components/Toast";
import { WorkBoard } from "./components/WorkBoard";
import { fitAllTerminals, focusTerminal } from "./lib/terminals";
import { activeTab, useLayout } from "./store/layout";
import { useUi } from "./store/ui";

/**
 * Frame: title bar (where you are) / navigator · stage · queue rail / status bar (fleet + fuel).
 * Review and Settings are full pages over the stage; launcher, grid and palette are dialogs.
 */
export function App() {
  const tabs = useLayout((s) => s.tabs);
  const activeTabId = useLayout((s) => s.activeTabId);
  const agentPanelOpen = useUi((s) => s.agentPanelOpen);
  const nav = useUi((s) => s.nav);
  const single = useUi((s) => s.single);
  const railTab = useUi((s) => s.railTab);
  const railWidth = useUi((s) => s.railWidths[s.railTab]);
  const mode = useUi((s) => s.mode);
  const historyOpen = useUi((s) => s.historyOpen);
  const focusKey = useLayout((s) => `${s.activeTabId}:${s.tabs.find((t) => t.id === s.activeTabId)?.focusedPaneId}`);
  const modalOpen = useUi((s) => s.settingsOpen || s.captureOpen || s.roadmapOpen || s.weeklyOpen || !!s.accountPicker || s.gridOpen || s.reviewOpen || s.paletteOpen || s.historyOpen);

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
      <div className="frame">
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
      <DiffReview />
      <SettingsPage />
      <AccountPicker />
      <GridPicker />
      <CommandPalette />
      {historyOpen && <HistoryPanel />}
      <CaptureBox />
      <RoadmapPage />
      <WeeklyPage />
      <PromptFill />
      <Checkpoints />
      <NoticeStack />
      <Toast />
      <UndoToast />
      <PaneDragGhost />
    </div>
  );
}
