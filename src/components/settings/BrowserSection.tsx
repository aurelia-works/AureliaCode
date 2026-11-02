import type { SectionProps } from "./registry";

/** Link handling and address-bar search, the two browser choices that change behaviour. */
export function BrowserSection({ draft, update }: SectionProps) {
  const links = draft.linkOpen ?? "local";
  const engine = draft.browserSearch ?? "duckduckgo";
  return (
    <>
      <section className="set-group">
        <h3>Links</h3>
        <label className="field">
          <span>Open links from chat</span>
          <select value={links} onChange={(e) => update((c) => (c.linkOpen = e.target.value as typeof links))}>
            <option value="local">In-app for local dev servers, otherwise the system browser</option>
            <option value="app">In-app for every link</option>
            <option value="system">Always the system browser</option>
          </select>
        </label>
        <p className="hint">⌥-click a local link to force the system browser.</p>
      </section>

      <section className="set-group">
        <h3>Address bar</h3>
        <label className="field">
          <span>Search with</span>
          <select value={engine} onChange={(e) => update((c) => (c.browserSearch = e.target.value as typeof engine))}>
            <option value="duckduckgo">DuckDuckGo</option>
            <option value="google">Google</option>
            <option value="bing">Bing</option>
          </select>
        </label>
        <p className="hint">Used when the address bar text is not a URL.</p>
      </section>
    </>
  );
}
