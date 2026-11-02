import { listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startCacheWatch } from "./lib/cache";
import { startHandoffAdvisor } from "./lib/handoffAdvisor";
import { startDiscord } from "./lib/discord";
import { installFileDrop } from "./lib/filedrop";
import { setHome } from "./lib/format";
import { ipc } from "./lib/ipc";
import { applyPaletteVars } from "./lib/palettes";
import { primeNotifications } from "./lib/notify";
import { primeSounds } from "./lib/sounds";
import { startHudBridge } from "./lib/hudBridge";
import { startControl } from "./lib/control";
import { startDispatchWatch } from "./lib/dispatch";
import { startOutbox } from "./lib/outbox";
import { startChains } from "./lib/chain";
import { startPulse } from "./lib/pulse";
import { startRoutines } from "./lib/routines";
import { startRemote } from "./lib/remote";
import { planResume } from "./lib/resume";
import { installShortcuts } from "./lib/shortcuts";
import { applyAppearance } from "./lib/terminals";
import { applyUiAppearance } from "./lib/uiAppearance";
import { onSystemThemeChange, resolveDark } from "./lib/theme";
import { startVoice } from "./lib/voice";
import { trackAttention, useAgents, type AgentEvent } from "./store/agents";
import { trackNoticeFocus, useNotices } from "./store/notifications";
import { useConfig } from "./store/config";
import { startGitPolling } from "./store/git";
import { startPrPolling } from "./store/prs";
import { serializeLayout, useLayout, type SavedLayout } from "./store/layout";
import { loadCustomAgents } from "./store/customAgents";
import { loadPrompts, startPromptLinks } from "./store/prompts";
import { loadRecents } from "./store/recents";
import { loadTasks } from "./store/tasks";
import { flushTeamRuns, loadTeamRuns, startTeamRunWatch } from "./store/teamRuns";
import { startNavHistory } from "./store/navHistory";
import { startThreadStore } from "./lib/threadStore";
import { flushWork, useWork } from "./store/work";
import { loadPlanner, watchSettled } from "./store/planner";
import { loadUiState, useUi } from "./store/ui";
import { startMetrics } from "./store/metrics";
import { startUsagePolling } from "./store/usage";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/chrome.css";
import "./styles/panes.css";
import "./styles/board.css";
import "./styles/agentview.css";
import "./styles/overlays.css";
import "./styles/notices.css";
import "./styles/settings.css";
import "./styles/deep.css";
import "./styles/skills.css";

function applyTheme() {
  const cfg = useConfig.getState().config;
  const dark = resolveDark(cfg?.theme ?? "system");
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  applyPaletteVars(cfg?.palette, dark);
  applyAppearance();
  if (cfg) applyUiAppearance();
}

function persistLayout() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => ipc.saveState("layout", serializeLayout()).catch(() => {});
  useLayout.subscribe((s, prev) => {
    if (s.tabs === prev.tabs && s.panes === prev.panes && s.activeTabId === prev.activeTabId) return;
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  });
  window.addEventListener("beforeunload", save);
}

async function boot() {
  await useConfig.getState().load();
  setHome(await homeDir().catch(() => ""));
  await Promise.all([loadUiState(), loadTasks(), loadRecents(), loadCustomAgents(), loadPrompts(), loadPlanner(), loadTeamRuns()]);
  // After tasks, so the first run on this build can migrate them into the work graph.
  await useWork.getState().load();
  const saved = await ipc.loadState<SavedLayout>("layout").catch(() => null);
  useLayout.getState().hydrate(saved);
  watchSettled();
  startNavHistory();
  await planResume(saved);
  startTeamRunWatch();
  persistLayout();
  startThreadStore();
  // Debounced stores write one last time when the window goes away.
  const flush = () => {
    void flushWork();
    void flushTeamRuns();
  };
  window.addEventListener("beforeunload", flush);
  window.addEventListener("pagehide", flush);

  applyTheme();
  onSystemThemeChange(applyTheme);
  useConfig.subscribe((s, prev) => s.config !== prev.config && applyTheme());
  useUi.subscribe((s, prev) => s.fontDelta !== prev.fontDelta && applyAppearance());

  await listen<{ paneId: string; code: number | null }>("pty-exit", (e) => useLayout.getState().closePane(e.payload.paneId));
  await listen<AgentEvent>("agent-event", (e) => useAgents.getState().handle(e.payload));
  ipc.agentEventsReady().catch(() => {});
  // Shells the terminal host kept for panes that are no longer in the layout.
  if (saved && useConfig.getState().config?.terminal.keepAlive !== false) ipc.ptyPrune(Object.keys(useLayout.getState().panes)).catch(() => {});
  await listen("menu-settings", () => useUi.getState().set({ settingsOpen: true }));

  window.addEventListener("focus", () => useUi.getState().set({ windowFocused: true }));
  window.addEventListener("blur", () => useUi.getState().set({ windowFocused: false }));
  installShortcuts();
  await installFileDrop();
  startUsagePolling();
  startGitPolling();
  startPrPolling();
  trackAttention();
  trackNoticeFocus();
  startCacheWatch();
  startHandoffAdvisor();
  startMetrics();
  startVoice().catch(() => {});
  primeNotifications();
  primeSounds();
  startHudBridge().catch(() => {});
  startRemote().catch(() => {});
  startOutbox();
  startChains();
  startPulse();
  startDispatchWatch();
  startRoutines().catch(() => {});
  startControl().catch(() => {});
  startDiscord();
  checkFullDiskAccess();

  createRoot(document.getElementById("root")!).render(<App />);
  hideSplash();
  startPromptLinks().catch(() => {});
}

/** Without Full Disk Access, commands run in the terminals trigger a macOS prompt per
 *  folder, and "access data from other apps" comes back every launch. */
async function checkFullDiskAccess() {
  if (await ipc.hasFullDiskAccess().catch(() => true)) return;
  useNotices.getState().push({
    kind: "info",
    key: "full-disk-access",
    sticky: true,
    title: "Give AureliaSpace Full Disk Access",
    body: "Stops the repeated macOS permission popups. Turn on AureliaSpace in the list, then reopen the app.",
    actions: [
      { label: "Open Settings", tone: "primary", run: () => void ipc.openFullDiskAccessSettings() },
      { label: "Not now", run: () => {} },
    ],
  });
}

/** Fades out the load-in splash from index.html once the first frame is up, after a minimum show time. */
function hideSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  const start = (window as { __splashStart?: number }).__splashStart ?? 0;
  const wait = Math.max(0, 1600 - (performance.now() - start));
  setTimeout(() => {
    requestAnimationFrame(() => splash.classList.add("out"));
    setTimeout(() => splash.remove(), 700);
  }, wait);
}

boot().catch((e) => {
  document.getElementById("splash")?.remove();
  document.body.textContent = `AureliaSpace failed to start: ${e}`;
});
