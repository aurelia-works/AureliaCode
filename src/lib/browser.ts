import { activeTab, paneIds, useLayout } from "../store/layout";

export { isLocalUrl, normalizeUrl, type SearchEngine } from "./url";

/** Opens `url` in a browser pane: reuses one in the same tab as `fromPane`, else splits right. */
export function openInBrowserPane(fromPane: string | undefined, url: string) {
  const layout = useLayout.getState();
  const tab = (fromPane && layout.tabs.find((t) => paneIds(t.root).includes(fromPane))) || activeTab();
  const existing = tab && paneIds(tab.root).find((id) => layout.panes[id]?.browser);
  if (existing) {
    if (url) layout.updatePane(existing, { browser: { url } });
    layout.focusPane(existing);
    return existing;
  }
  const from = fromPane ?? tab?.focusedPaneId;
  return from ? layout.splitPane(from, "row", { browserUrl: url }) : layout.newTab({ browserUrl: url });
}
