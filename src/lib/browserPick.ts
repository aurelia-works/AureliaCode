/** Element picking in the built-in browser: a click becomes a short, safe reference the
 *  agent can act on. The page sends one JSON payload through a custom navigation scheme;
 *  the app never gives an external page IPC access. */

/** Window event a browser pane emits when an element is picked. */
export const BROWSER_PICK = "aurelia-browser-pick";

export interface PickedElement {
  selector: string;
  tag: string;
  text: string;
  /** Outer HTML, trimmed to a useful snippet. */
  html?: string;
  /** Page URL when the pick happened. */
  url?: string;
  /** Screenshot path, when the app captured one. */
  shot?: string;
  /** Viewport rect in CSS pixels. */
  rect?: { x: number; y: number; w: number; h: number };
}

const MAX_SELECTOR = 400;
const MAX_TEXT = 300;
const MAX_HTML = 1200;

/** A stable-ish selector: id, then a short nth-of-type path. */
export function selectorFor(tag: string, id: string, path: string): string {
  if (id) return `#${cssEscape(id)}`;
  return path || tag.toLowerCase();
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

/** Trims a page payload before it crosses into the app. */
export function sanitizePick(raw: unknown): PickedElement | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const selector = typeof r.selector === "string" ? r.selector.trim().slice(0, MAX_SELECTOR) : "";
  const tag = typeof r.tag === "string" ? r.tag.trim().toLowerCase().slice(0, 40) : "";
  if (!selector || !tag) return null;
  const text = typeof r.text === "string" ? r.text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) : "";
  const html = typeof r.html === "string" ? r.html.slice(0, MAX_HTML) : undefined;
  const url = typeof r.url === "string" ? r.url.slice(0, 2000) : undefined;
  const shot = typeof r.shot === "string" ? r.shot.slice(0, 2000) : undefined;
  const rect =
    r.rect && typeof r.rect === "object"
      ? (() => {
          const q = r.rect as Record<string, unknown>;
          const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
          return { x: n(q.x), y: n(q.y), w: n(q.w), h: n(q.h) };
        })()
      : undefined;
  const out: PickedElement = { selector, tag, text };
  if (html) out.html = html;
  if (url) out.url = url;
  if (shot) out.shot = shot;
  if (rect) out.rect = rect;
  return out;
}

/** The message inserted into the composer. */
export function pickPrompt(p: PickedElement): string {
  const lines = [`Browser element: ${p.selector} (<${p.tag}>)`];
  if (p.text) lines.push(`Text: “${p.text}”`);
  if (p.url) lines.push(`Page: ${p.url}`);
  if (p.html) lines.push(`HTML: ${p.html}`);
  if (p.shot) lines.push(`Screenshot: ${p.shot}`);
  return lines.join("\n");
}

/** Parses the `aurelia-pick:<encoded JSON>` navigation payload. */
export function parsePickUrl(url: string): PickedElement | null {
  const prefix = "aurelia-pick:";
  if (!url.startsWith(prefix)) return null;
  try {
    const decoded = decodeURIComponent(url.slice(prefix.length));
    return sanitizePick(JSON.parse(decoded));
  } catch {
    return null;
  }
}

/**
 * Injected into the child webview. Clicking the page sends one payload and restores the
 * page. `on` false removes the listeners. Kept self-contained: external pages get no IPC.
 */
export function pickerScript(on: boolean): string {
  return `(() => {
  const KEY = "__aureliaPick";
  if (window[KEY] && !${on ? "true" : "false"}) { window[KEY](); return; }
  if (!${on ? "true" : "false"}) return;
  if (window[KEY]) { window[KEY](); }
  const cssEscape = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/[^a-zA-Z0-9_-]/g, (c) => "\\\\" + c));
  const pathOf = (el) => {
    if (el.id) return "#" + cssEscape(el.id);
    const bits = [];
    let n = el;
    while (n && n.nodeType === 1 && bits.length < 5) {
      let part = n.tagName.toLowerCase();
      const parent = n.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === n.tagName);
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(n) + 1) + ")";
      }
      bits.unshift(part);
      n = parent;
    }
    return bits.join(" > ");
  };
  const outline = "2px solid #e9b04b";
  let last = null;
  const restore = () => { if (last) last.style.outline = ""; last = null; };
  const move = (e) => { restore(); const t = e.target; if (t && t.style) { last = t; t.style.outline = outline; } };
  const click = (e) => {
    e.preventDefault(); e.stopPropagation();
    const el = e.target;
    const r = el.getBoundingClientRect();
    const payload = {
      selector: pathOf(el),
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.textContent || "").trim().slice(0, 300),
      html: (el.outerHTML || "").slice(0, 1200),
      url: location.href,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    };
    window[KEY] = () => { restore(); document.removeEventListener("mousemove", move, true); document.removeEventListener("click", click, true); document.removeEventListener("keydown", key, true); };
    window[KEY]();
    location.href = "aurelia-pick:" + encodeURIComponent(JSON.stringify(payload));
  };
  const key = (e) => { if (e.key === "Escape") { window[KEY](); } };
  document.addEventListener("mousemove", move, true);
  document.addEventListener("click", click, true);
  document.addEventListener("keydown", key, true);
  window[KEY] = () => { restore(); document.removeEventListener("mousemove", move, true); document.removeEventListener("click", click, true); document.removeEventListener("keydown", key, true); delete window[KEY]; };
})();`;
}
