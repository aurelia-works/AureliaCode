import { listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { Profiler } from "react";
import { createRoot } from "react-dom/client";
import { App, preloadScreens } from "./App";
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
import { startTrayIcon } from "./lib/trayIcon";
import { startControl } from "./lib/control";
import { startDispatchWatch } from "./lib/dispatch";
import { startOutbox } from "./lib/outbox";
import { startChains } from "./lib/chain";
import { startPulse } from "./lib/pulse";
import { startRoutines } from "./lib/routines";
import { startNightly } from "./store/nightly";
import { startRemote } from "./lib/remote";
import { planResume } from "./lib/resume";
import { installShortcuts, selectAll } from "./lib/shortcuts";
import { splashDelay } from "./lib/splash";
import { applyAppearance } from "./lib/terminals";
import { applyUiAppearance } from "./lib/uiAppearance";
import { onSystemThemeChange, resolveDark } from "./lib/theme";
import { startVoice } from "./lib/voice";
import { trackAttention, useAgents, type AgentEvent } from "./store/agents";
import { trackNoticeFocus, useNotices } from "./store/notifications";
import { useConfig } from "./store/config";
import { startGitPolling } from "./store/git";
import { startPrPolling } from "./store/prs";
import { startShares } from "./store/shares";
import { startMergeQueue } from "./store/mergeQueue";
import { startDevServerWatch } from "./store/devServers";
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
import "./styles/crew.css";
import "./styles/browser.css";
import "./styles/board.css";
import "./styles/agentview.css";
import "./styles/overlays.css";
import "./styles/notices.css";
import "./styles/settings.css";
import "./styles/deep.css";
import "./styles/skills.css";
import { readSaved } from "./lib/savedState";
import { warnUnreadable } from "./store/notifications";

function applyTheme() {
  const cfg = useConfig.getState().config;
  const dark = resolveDark(cfg?.theme ?? "system");
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  applyPaletteVars(cfg?.palette, dark);
  applyAppearance();
  if (cfg) applyUiAppearance();
}

/** `canSave` is false when layout.json couldn't be read: quitting would otherwise replace every saved thread. */
function persistLayout(canSave: boolean) {
  if (!canSave) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => ipc.saveState("layout", serializeLayout()).catch(() => {});
  useLayout.subscribe((s, prev) => {
    if (s.tabs === prev.tabs && s.panes === prev.panes && s.activeTabId === prev.activeTabId) return;
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  });
  window.addEventListener("beforeunload", save);
}

/** `npm run perf` reads these marks: boot:start, boot:render, boot:painted, boot:splash, boot:ready. */
const mark = (name: string) => performance.mark(`boot:${name}`);
/** The preview harness sets `__perfProfile` to total React render time (`npm run perf`). */
const perf = (window as { __perfProfile?: { commits: number; ms: number } }).__perfProfile;

async function boot() {
  mark("start");
  // Independent reads go out together; each await below is something the next step needs.
  const [home] = await Promise.all([homeDir().catch(() => ""), useConfig.getState().load()]);
  setHome(home);
  const [layoutRead] = await Promise.all([
    readSaved(() => ipc.loadState<SavedLayout>("layout")),
    // Work after tasks, so the first run on this build can migrate them into the work graph.
    Promise.all([loadUiState(), loadTasks(), loadRecents(), loadCustomAgents(), loadPrompts(), loadPlanner(), loadTeamRuns()]).then(() => useWork.getState().load()),
  ]);
  if (!layoutRead.ok) warnUnreadable("layout.json", layoutRead.error);
  const saved = layoutRead.ok ? layoutRead.value : null;
  useLayout.getState().hydrate(saved);
  watchSettled();
  startNavHistory();
  startTeamRunWatch();
  persistLayout(layoutRead.ok);
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

  // Before the first render: resume plans queue each terminal's first command, and terminals spawn on render.
  await Promise.all([
    planResume(saved),
    listen<{ paneId: string; code: number | null }>("pty-exit", (e) => useLayout.getState().closePane(e.payload.paneId)),
    listen<AgentEvent>("agent-event", (e) => useAgents.getState().handle(e.payload)).then(() => ipc.agentEventsReady().catch(() => {})),
    listen("menu-settings", () => useUi.getState().set({ settingsOpen: true })),
    listen("menu-select-all", selectAll),
  ]);
  // Shells the terminal host kept for panes that are no longer in the layout.
  if (saved && useConfig.getState().config?.terminal.keepAlive !== false) ipc.ptyPrune(Object.keys(useLayout.getState().panes)).catch(() => {});

  window.addEventListener("focus", () => useUi.getState().set({ windowFocused: true }));
  window.addEventListener("blur", () => useUi.getState().set({ windowFocused: false }));
  installShortcuts();

  mark("render");
  const app = <App />;
  createRoot(document.getElementById("root")!).render(
    perf ? (
      <Profiler id="app" onRender={(_id, _phase, ms) => ((perf.commits += 1), (perf.ms += ms))}>
        {app}
      </Profiler>
    ) : (
      app
    ),
  );
  requestAnimationFrame(() => mark("painted"));
  hideSplash();

  // Background work starts once the first frame is queued.
  installFileDrop().catch(() => {});
  startUsagePolling();
  startGitPolling();
  startPrPolling();
  startShares().catch(() => {});
  startMergeQueue().catch(() => {});
  startDevServerWatch();
  trackAttention();
  trackNoticeFocus();
  startCacheWatch();
  startHandoffAdvisor();
  startMetrics();
  startVoice().catch(() => {});
  primeNotifications();
  primeSounds();
  startHudBridge().catch(() => {});
  startTrayIcon();
  startRemote().catch(() => {});
  startOutbox();
  startChains();
  startPulse();
  startDispatchWatch();
  startRoutines().catch(() => {});
  startNightly().catch(() => {});
  startControl().catch(() => {});
  startDiscord();
  checkFullDiskAccess();
  startPromptLinks().catch(() => {});
  preloadScreens();
  mark("ready");
}

/** Without Full Disk Access, commands run in the terminals trigger a macOS prompt per
 *  folder, and "access data from other apps" comes back every launch. */
async function checkFullDiskAccess() {
  if (await ipc.hasFullDiskAccess().catch(() => true)) return;
  useNotices.getState().push({
    kind: "info",
    key: "full-disk-access",
    sticky: true,
    title: "Give AureliaCode Full Disk Access",
    body: "Stops the repeated macOS permission popups. Turn on AureliaCode in the list, then reopen the app.",
    actions: [
      {
        label: "Open Settings",
        tone: "primary",
        run: () => {
          void ipc.openFullDiskAccessSettings();
          if (useUi.getState().prefs.permissionDrag) useUi.getState().set({ permissionsOpen: true });
        },
      },
      { label: "Not now", run: () => {} },
    ],
  });
}

/** Fades out the load-in splash from index.html once the first frame is up, after its intro and the hold you set. */
function hideSplash() {
  const splash = document.getElementById("splash");
  // Preview harness pages have no inline splash, but their boot marks still need `splash`.
  if (!splash) {
    mark("splash");
    return;
  }
  const start = (window as { __splashStart?: number }).__splashStart ?? 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = splashDelay(useUi.getState().prefs.splashMinMs, performance.now() - start, reduced);
  setTimeout(() => {
    mark("splash");
    // Two frames: the class change lands after the first app frame is on screen, never
    // in the same paint that replaces the splash.
    requestAnimationFrame(() => requestAnimationFrame(() => splash.classList.add("out")));
    setTimeout(() => splash.remove(), 700);
  }, wait);
}

boot().catch((e) => {
  document.getElementById("splash")?.remove();
  document.body.textContent = `AureliaCode failed to start: ${e}`;
});
