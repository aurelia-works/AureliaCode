export type SearchEngine = "duckduckgo" | "google" | "bing";

const SEARCH: Record<SearchEngine, string> = {
  duckduckgo: "https://duckduckgo.com/?q=",
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
};

/** Turns address-bar input into a URL: bare hosts get a scheme, anything else becomes a search. */
export function normalizeUrl(input: string, engine: SearchEngine = "duckduckgo"): string {
  const t = input.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[\da-f:]+\])(:\d+)?([/?#]|$)/i.test(t)) return `http://${t}`;
  if (!/\s/.test(t) && /\.[a-z]{2,}([:/?#]|$)/i.test(t)) return `https://${t}`;
  return `${SEARCH[engine] ?? SEARCH.duckduckgo}${encodeURIComponent(t)}`;
}

export const isLocalUrl = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?([/?#]|$)/i.test(url);
