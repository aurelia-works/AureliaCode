// Agent browser actions (browser_agent.rs). Runs as an async function body inside the pane's
// WKWebView in a client content world: it shares the page's DOM, but page scripts can't see
// or patch anything here. `a` is the JSON request; the result is a JSON string.
// Refs (e1, e2, ...) stay attached to the same element until the page navigates.
const A = JSON.parse(a);
const S = (globalThis.__aurelia ??= { ids: new WeakMap(), refs: new Map(), next: 1 });
const MAX_SNAPSHOT = 20000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => {
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};
const page = () => ({ url: location.href, title: document.title });

function refFor(el) {
  let id = S.ids.get(el);
  if (!id) {
    id = "e" + S.next++;
    S.ids.set(el, id);
    S.refs.set(id, new WeakRef(el));
  }
  return id;
}

function target(required) {
  if (A.ref) {
    const el = S.refs.get(A.ref)?.deref();
    if (!el || !el.isConnected) throw new Error(`ref ${A.ref} is gone (the page changed or navigated); take a new snapshot`);
    return el;
  }
  if (A.selector) {
    const el = document.querySelector(A.selector);
    if (!el) throw new Error(`nothing matches ${A.selector}`);
    return el;
  }
  if (required) throw new Error("pass ref (from snapshot) or selector");
  return null;
}

function shown(el) {
  const st = getComputedStyle(el);
  if (st.display === "none" || st.visibility === "hidden" || st.visibility === "collapse" || el.getAttribute("aria-hidden") === "true") return false;
  // Content of a closed <details> (and content-visibility: hidden) keeps its display but has
  // no box. display: contents never has a box, yet its children render.
  return st.display === "contents" || !el.checkVisibility || el.checkVisibility();
}

const INPUT_ROLE = { button: "button", submit: "button", reset: "button", image: "button", checkbox: "checkbox", radio: "radio", range: "slider", search: "searchbox", number: "spinbutton" };
const TAG_ROLE = {
  button: "button", textarea: "textbox", option: "option", img: "img", nav: "navigation", main: "main", header: "banner",
  footer: "contentinfo", aside: "complementary", form: "form", dialog: "dialog", ul: "list", ol: "list", li: "listitem",
  table: "table", tr: "row", th: "columnheader", td: "cell", label: "label", summary: "button", details: "group",
  h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading",
};
const INTERACTIVE = new Set(["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "listbox", "option", "slider", "spinbutton", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "treeitem", "clickable"]);
const NAME_FROM_TEXT = new Set(["button", "link", "heading", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "treeitem", "clickable", "label", "checkbox", "radio", "switch", "columnheader"]);
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK"]);

function roleOf(el) {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit.split(/\s+/)[0];
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return el.hasAttribute("href") ? "link" : "";
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return type === "hidden" ? "" : INPUT_ROLE[type] || "textbox";
  }
  if (tag === "select") return el.multiple ? "listbox" : "combobox";
  if (tag === "svg") return el.getAttribute("aria-label") ? "img" : "";
  if (tag === "section" && (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby"))) return "region";
  if (TAG_ROLE[tag]) return TAG_ROLE[tag];
  if (el.isContentEditable && el.parentElement && !el.parentElement.isContentEditable) return "textbox";
  // A div/span acting as a button: focusable or pointer cursor that its parent doesn't have.
  if (el.tabIndex >= 0 && el.hasAttribute("tabindex")) return "clickable";
  if (getComputedStyle(el).cursor === "pointer" && el.parentElement && getComputedStyle(el.parentElement).cursor !== "pointer") return "clickable";
  return "";
}

function nameOf(el, role) {
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const t = by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
    if (t.trim()) return clip(t, 100);
  }
  const label = el.getAttribute("aria-label");
  if (label) return clip(label, 100);
  if (el.tagName === "IMG") return clip(el.alt || el.title, 100);
  if (el.labels?.length) return clip([...el.labels].map((l) => l.innerText).join(" "), 100);
  if (role === "textbox" || role === "searchbox" || role === "combobox") return clip(el.placeholder || el.title, 100);
  if (NAME_FROM_TEXT.has(role)) return clip(el.innerText || el.value || el.title, 100);
  return clip(el.title, 100);
}

function attrsOf(el, role) {
  const bits = [];
  if (role === "heading") bits.push(`level=${el.tagName[1] || el.getAttribute("aria-level") || "?"}`);
  if (el.disabled || el.getAttribute("aria-disabled") === "true") bits.push("disabled");
  if (el.checked || el.getAttribute("aria-checked") === "true") bits.push("checked");
  if (el.getAttribute("aria-selected") === "true" || (role === "option" && el.selected)) bits.push("selected");
  const expanded = el.getAttribute("aria-expanded");
  if (expanded) bits.push(`expanded=${expanded}`);
  if (el === document.activeElement) bits.push("focused");
  if (role === "link") {
    const href = el.getAttribute("href") || "";
    if (href && !href.startsWith("javascript:")) bits.push(`href=${clip(href, 80)}`);
  }
  const r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) bits.push("offscreen");
  return bits.length ? " [" + bits.join(", ") + "]" : "";
}

function childrenOf(node) {
  const kids = node.shadowRoot ? [...node.shadowRoot.childNodes] : [...node.childNodes];
  return kids.flatMap((k) => (k.tagName === "SLOT" ? k.assignedNodes({ flatten: true }) : [k]));
}

function snapshot() {
  const root = target(false) || document.body || document.documentElement;
  const lines = [];
  let size = 0;
  let cut = 0;
  const push = (line) => {
    if (size + line.length > MAX_SNAPSHOT) return void cut++;
    lines.push(line);
    size += line.length + 1;
  };
  const walk = (node, depth, inNamed) => {
    if (node.nodeType === 3) {
      if (!inNamed) {
        const t = clip(node.textContent, 160);
        if (t) push(`${"  ".repeat(depth)}- text "${t}"`);
      }
      return;
    }
    if (node.nodeType !== 1 || SKIP.has(node.tagName) || !shown(node)) return;
    const role = roleOf(node);
    let next = depth;
    let named = inNamed;
    if (role && role !== "presentation" && role !== "none") {
      const name = nameOf(node, role);
      let value = "";
      if ((role === "textbox" || role === "searchbox" || role === "spinbutton" || role === "combobox") && "value" in node && node.value) value = `: "${clip(node.value, 80)}"`;
      push(`${"  ".repeat(depth)}- ${role}${name ? ` "${name}"` : ""}${value}${attrsOf(node, role)} [ref=${refFor(node)}]`);
      next = depth + 1;
      named = named || NAME_FROM_TEXT.has(role);
    }
    for (const kid of childrenOf(node)) walk(kid, next, named);
  };
  walk(root, 0, false);
  const head = [
    `url: ${location.href}`,
    `title: ${document.title}`,
    `viewport: ${innerWidth}x${innerHeight}, scrolled ${Math.round(scrollY)}/${Math.max(0, document.documentElement.scrollHeight - innerHeight)}`,
  ];
  if (cut) lines.push(`… ${cut} more lines cut at ${MAX_SNAPSHOT} chars; snapshot a ref or selector to see a part`);
  return { text: head.concat("", lines).join("\n") };
}

function describe(el) {
  if (!el || el.nodeType !== 1) return String(el);
  let s = el.tagName.toLowerCase();
  if (el.id) s += "#" + el.id;
  const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
  if (cls.length) s += "." + cls.join(".");
  const t = clip(el.innerText || el.getAttribute("aria-label") || "", 40);
  return `${s}${t ? ` "${t}"` : ""} [ref=${refFor(el)}]`;
}

/** Resolves after `quiet` ms with no DOM changes, or after `max` ms. */
function settle(quiet, max) {
  return new Promise((done) => {
    let timer = setTimeout(finish, quiet);
    const cap = setTimeout(finish, max);
    const mo = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(finish, quiet);
    });
    mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    function finish() {
      mo.disconnect();
      clearTimeout(timer);
      clearTimeout(cap);
      done();
    }
  });
}

const CODES = { Enter: "Enter", Escape: "Escape", Tab: "Tab", Backspace: "Backspace", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", " ": "Space" };

async function act() {
  const kind = A.kind || "click";
  const el = target(kind !== "press" && kind !== "scroll");
  let note = "";
  const mouse = (types, x, y) => {
    const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
    for (const t of types) {
      const down = t.endsWith("down");
      const Ctor = t.startsWith("pointer") ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(t, { ...o, buttons: down ? 1 : 0, pointerType: "mouse", isPrimary: true }));
    }
  };
  const centre = () => {
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    if (top && top !== el && !el.contains(top)) note = `covered by ${describe(top)} at its centre; dispatched to the element anyway`;
    return [x, y];
  };
  if (kind === "click") {
    const [x, y] = centre();
    mouse(["pointerover", "mouseover", "pointerdown", "mousedown"], x, y);
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
    mouse(["pointerup", "mouseup", "click"], x, y);
  } else if (kind === "hover") {
    const [x, y] = centre();
    mouse(["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"], x, y);
  } else if (kind === "type") {
    const text = String(A.text ?? "");
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, (A.clear ? "" : el.value) + text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable) {
      if (A.clear) document.execCommand("selectAll") && document.execCommand("delete");
      document.execCommand("insertText", false, text);
    } else throw new Error(`${describe(el)} is not a text field`);
  } else if (kind === "press") {
    const key = String(A.key || "Enter");
    const to = el || document.activeElement || document.body;
    const mods = new Set(A.modifiers || []);
    const o = { key, code: CODES[key] || (key.length === 1 ? "Key" + key.toUpperCase() : key), bubbles: true, cancelable: true, composed: true, shiftKey: mods.has("Shift"), metaKey: mods.has("Meta"), ctrlKey: mods.has("Control"), altKey: mods.has("Alt") };
    const go = to.dispatchEvent(new KeyboardEvent("keydown", o));
    if (go && key === "Enter" && to.form && to.tagName === "INPUT") to.form.requestSubmit();
    to.dispatchEvent(new KeyboardEvent("keyup", o));
    note = "synthetic key events: they reach page handlers but don't type text; use kind type for text";
  } else if (kind === "select") {
    if (!(el instanceof HTMLSelectElement)) throw new Error(`${describe(el)} is not a <select>; click a custom dropdown open, then click the option`);
    const want = String(A.value ?? "");
    const opt = [...el.options].find((o) => o.value === want || o.label === want || o.text.trim() === want);
    if (!opt) throw new Error(`no option "${want}"; options: ${[...el.options].map((o) => o.label).slice(0, 20).join(", ")}`);
    el.value = opt.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (kind === "scroll") {
    const dx = Number(A.dx) || 0;
    const dy = Number(A.dy) || 0;
    if (el && !dx && !dy) el.scrollIntoView({ block: "center" });
    else (el || window).scrollBy(dx, dy);
  } else throw new Error(`unknown kind ${kind} (click, type, press, hover, select, scroll)`);
  await settle(150, 1000);
  return { ok: true, kind, target: el ? describe(el) : undefined, note: note || undefined, ...page() };
}

async function wait() {
  const start = Date.now();
  // Rust may cut the wait to what's left of the call, down to 0 (check once).
  const until = start + Math.min(Number(A.timeoutMs ?? 5000), 15000);
  const cond = () => {
    if (A.selector) {
      const el = document.querySelector(A.selector);
      const ok = !!el && shown(el);
      return A.gone ? !ok : ok;
    }
    if (A.text) {
      const has = (document.body?.innerText || "").includes(A.text);
      return A.gone ? !has : has;
    }
    return document.readyState === "complete";
  };
  while (!cond()) {
    if (Date.now() > until) return { ok: false, waitedMs: Date.now() - start, reason: "timed out", ...page() };
    await sleep(100);
  }
  if (!A.selector && !A.text) {
    await document.fonts?.ready;
    await settle(400, Math.max(0, until - Date.now()));
  }
  return { ok: true, waitedMs: Date.now() - start, ...page() };
}

function effectiveBg(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
  }
  return "none (page default)";
}

function inspect() {
  const el = target(true);
  const r = el.getBoundingClientRect();
  const st = getComputedStyle(el);
  const covered = new Set();
  if (r.width > 0 && r.height > 0) {
    for (const [fx, fy] of [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]]) {
      const x = r.left + r.width * fx;
      const y = r.top + r.height * fy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const top = document.elementFromPoint(x, y);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) covered.add(describe(top));
    }
  }
  const clippedBy = [];
  for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.overflowX === "visible" && s.overflowY === "visible") continue;
    const p = n.getBoundingClientRect();
    if (r.left < p.left - 0.5 || r.right > p.right + 0.5 || r.top < p.top - 0.5 || r.bottom > p.bottom + 0.5) clippedBy.push(describe(n));
    if (clippedBy.length >= 3) break;
  }
  const pick = ["display", "position", "zIndex", "opacity", "width", "height", "margin", "padding", "gap", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "color", "backgroundColor", "border", "borderRadius", "boxShadow", "overflow", "textOverflow", "whiteSpace"];
  const styles = Object.fromEntries(pick.map((k) => [k, st[k]]).filter(([, v]) => v && v !== "none" && v !== "normal" && v !== "auto" && v !== "0px"));
  const round = (v) => Math.round(v * 10) / 10;
  return {
    target: describe(el),
    rect: { x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height) },
    viewport: { w: innerWidth, h: innerHeight },
    visible: shown(el) && r.width > 0 && r.height > 0,
    inViewport: r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight,
    coveredBy: [...covered],
    clippedBy,
    textOverflow: { x: el.scrollWidth > el.clientWidth + 1, y: el.scrollHeight > el.clientHeight + 1 },
    effectiveBackground: effectiveBg(el),
    styles,
    text: clip(el.innerText, 200),
  };
}

/** Viewport rect of a target, for a cropped screenshot. */
function rect() {
  const el = target(true);
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, r.left), y: Math.max(0, r.top), w: Math.min(r.width, innerWidth), h: Math.min(r.height, innerHeight), target: describe(el) };
}

const RUN = { snapshot, act, wait, inspect, rect };
try {
  if (!RUN[A.action]) throw new Error(`unknown action ${A.action}`);
  return JSON.stringify(await RUN[A.action]());
} catch (e) {
  return JSON.stringify({ error: String(e && e.message ? e.message : e) });
}
