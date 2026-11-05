// Visual replies: a page an agent shows with aurelia_show_html, drawn as a card in the chat.
// The page comes from the tool call's own input, so a reopened chat keeps it. It runs in an
// iframe sandboxed to scripts only (an opaque origin: no app storage, IPC, popups or top
// navigation). A small bridge sends its height and link clicks out and takes theme changes in.
// Pure, for `node --test`.

/** The app tokens a page can use, read off <html> at render time. */
export const THEME_VARS = [
  "--bg", "--surface", "--surface-2", "--border", "--border-strong", "--line",
  "--text", "--text-dim", "--text-faint", "--accent", "--accent-strong", "--accent-ink",
  "--ok", "--err", "--warn", "--attn", "--work", "--font-ui", "--font-mono",
] as const;

export interface VisualReply {
  title: string;
  html: string;
  /** Where the renders server serves the same page, for opening it in a browser pane. */
  url?: string;
}

/** True for aurelia_show_html as Claude (mcp__aurelia__…), Codex (aurelia.…) or bare names it. */
export function isVisualTool(name: string | undefined): boolean {
  return !!name && /(?:^|__|\.)aurelia_show_html$/.test(name);
}

const RENDER_URL = /http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{16}\/[0-9a-f]{16}\.html/;

export function parseVisual(input: Record<string, unknown>, result: string | undefined): VisualReply | null {
  const html = typeof input.html === "string" ? input.html : "";
  if (!html.trim()) return null;
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "Visual reply";
  return { title, html, url: result?.match(RENDER_URL)?.[0] };
}

const MIN_H = 120;
const MAX_H = 520;

/** The card's iframe height for a page `h` px tall; taller pages scroll, or open full. */
export function frameHeight(h: number): number {
  if (!Number.isFinite(h)) return MIN_H;
  return Math.min(MAX_H, Math.max(MIN_H, Math.ceil(h)));
}

// Runs inside the page. Posts carry `aureliaVisual` so the card can tell them from the page's own.
const BRIDGE = `(function(){
var post=function(m){m.aureliaVisual=1;parent.postMessage(m,"*")};
var size=function(){post({height:document.documentElement.scrollHeight})};
addEventListener("load",size);
if(window.ResizeObserver)new ResizeObserver(size).observe(document.documentElement);
document.addEventListener("click",function(e){
var a=e.target&&e.target.closest&&e.target.closest("a[href]");
if(!a||a.getAttribute("href").charAt(0)==="#")return;
e.preventDefault();
if(/^https?:/i.test(a.href))post({open:a.href});
},true);
addEventListener("message",function(e){
var d=e.source===parent&&e.data;if(!d||!d.aureliaTheme)return;
var r=document.documentElement;
for(var k in d.aureliaTheme)r.style.setProperty(k,d.aureliaTheme[k]);
r.style.colorScheme=d.scheme;
});
})();`;

/** The page as an iframe srcdoc: app theme and bridge first in its head, so its own styles win. */
export function visualSrcdoc(html: string, vars: Record<string, string>, scheme: "dark" | "light"): string {
  const decls = Object.entries(vars)
    .map(([k, v]) => `${k}: ${v.replace(/[<>{}]/g, "")};`)
    .join(" ");
  const head =
    `<meta charset="utf-8"><style>:root { color-scheme: ${scheme}; ${decls} }\n` +
    `html, body { margin: 0; } body { padding: 14px 16px; color: var(--text); font: 13px/1.55 var(--font-ui, system-ui, sans-serif); }\n` +
    `a { color: var(--accent-strong, var(--accent)); }</style><script>${BRIDGE}</script>`;
  const open = html.match(/<head[^>]*>/i);
  if (open) return html.replace(open[0], `${open[0]}${head}`);
  const doctype = html.match(/^\s*<!doctype[^>]*>/i);
  const htmlTag = html.match(/<html[^>]*>/i);
  if (htmlTag) return html.replace(htmlTag[0], `${htmlTag[0]}<head>${head}</head>`);
  const body = doctype ? html.slice(doctype[0].length) : html;
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}
