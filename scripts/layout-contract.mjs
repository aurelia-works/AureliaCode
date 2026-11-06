// Geometry and focus contract for the threads grid: sidebar identity, the single-thread
// location title, and whether a short pane scrolls its card instead of clipping the footer
// or the composer. Prints measurements. `--check` fails when the contract is missed.
//
//   node scripts/layout-contract.mjs
//   node scripts/layout-contract.mjs --check sidebar|title|overflow|all
//   node scripts/layout-contract.mjs --url http://127.0.0.1:1437 --out design/review/hillclimb-3/before
//   node scripts/layout-contract.mjs --inject /tmp/proto.css
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { ratio } from "../src/lib/contrast.ts";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const check = opt("check", "");
const checks = new Set(check === "all" ? ["sidebar", "title", "overflow"] : check ? check.split(",") : []);
const outDir = opt("out", "");
const injectPath = opt("inject", "");
const injectCss = injectPath ? readFileSync(injectPath, "utf8") : "";

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`FAIL ${msg}`);
};

const freePort = () =>
  new Promise((ok, failPort) => {
    const s = createServer();
    s.once("error", failPort);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

let vite;
async function serve() {
  const given = opt("url", "");
  if (given) return given.replace(/\/$/, "");
  const port = await freePort();
  vite = spawn("npx", ["vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  vite.stdout.on("data", (d) => (log += d));
  vite.stderr.on("data", (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`vite exited:\n${log.slice(-1500)}`);
    try {
      if ((await fetch(`${url}/design/preview/`)).ok) return url;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`vite did not start:\n${log.slice(-1500)}`);
}

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1100x900", width: 1100, height: 900 },
  { name: "1100x700", width: 1100, height: 700 },
  { name: "800x900", width: 800, height: 900 },
];

async function prepare(page, base, query) {
  if (injectCss) await page.addInitScript((css) => {
    const tag = () => {
      const el = document.createElement("style");
      el.setAttribute("data-layout-inject", "");
      el.textContent = css;
      document.documentElement.append(el);
    };
    tag();
    document.addEventListener("DOMContentLoaded", tag);
  }, injectCss);
  const theme = query.includes("theme=") ? "" : "theme=dark&";
  await page.goto(`${base}/design/preview/?${theme}${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => [...document.querySelectorAll(".th-title")].some((el) => (el.textContent ?? "").includes("idempotency")),
    null,
    { timeout: 20_000 },
  );
  if (injectCss) await page.addStyleTag({ content: injectCss });
  await page.waitForTimeout(150);
}

async function readGrid(page) {
  return page.evaluate(() => {
    const nav = document.querySelector(".navigator");
    const list = document.querySelector(".side-list");
    const navBox = nav.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    const token = getComputedStyle(document.documentElement).getPropertyValue("--nav-w").trim();
    const rows = [...document.querySelectorAll(".nav-thread")].map((thread) => {
      const row = thread.querySelector(".th-row");
      const title = thread.querySelector(".th-title");
      const branch = thread.querySelector(".th-br");
      const state = thread.querySelector(".th-state");
      const glyph = thread.querySelector(".glyph");
      const rb = row.getBoundingClientRect();
      const visible = rb.bottom > listBox.top + 4 && rb.top < listBox.bottom - 4;
      const titleCut = !!title && (title.scrollWidth > title.clientWidth + 1 || title.scrollHeight > title.clientHeight + 2);
      const branchCut = !!branch && (branch.scrollWidth > branch.clientWidth + 1 || branch.scrollHeight > branch.clientHeight + 2);
      const stateClass = ["needs_input", "working", "done", "idle", "starting"].find((s) => row.classList.contains(s)) ?? "";
      return {
        id: thread.dataset.thread,
        stateClass,
        title: (title?.textContent ?? "").trim(),
        titleW: title ? Math.round(title.getBoundingClientRect().width) : 0,
        titleH: title ? Math.round(title.getBoundingClientRect().height) : 0,
        titleCut,
        branch: (branch?.textContent ?? "").trim(),
        branchW: branch ? Math.round(branch.getBoundingClientRect().width) : 0,
        branchCut,
        stateWord: (state?.textContent ?? "").trim(),
        glyphLabel: glyph?.getAttribute("aria-label") ?? "",
        rowH: Math.round(rb.height),
        visible,
        navOverflow: rb.right > navBox.right + 1,
      };
    });
    const foot = [...document.querySelectorAll(".side-foot button, .side-top button, .side-top input")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        name: el.getAttribute("aria-label") || (el.textContent ?? "").replace(/\s+/g, " ").trim(),
        inside: r.top >= navBox.top - 1 && r.bottom <= navBox.bottom + 1 && r.height > 8,
        display: getComputedStyle(el).display,
      };
    });
    const hiddenActs = [...document.querySelectorAll(".nav-thread-actions .nav-act")].map((el) => el.getAttribute("aria-label") || "");
    const stage = document.querySelector(".tab-content:not(.hidden)") ?? document;
    const panes = [...stage.querySelectorAll(".pane")].filter((pane) => pane.getBoundingClientRect().width > 20).map((pane) => {
      const pb = pane.getBoundingClientRect();
      const brief = pane.querySelector(".pane-brief");
      const feed = pane.querySelector(".pane-brief-feed");
      const meta = pane.querySelector(".tc-meta");
      const dock = pane.querySelector(".chat-dock");
      const log = pane.querySelector(".chat-log");
      const bb = brief?.getBoundingClientRect();
      const fb = feed?.getBoundingClientRect();
      const mb = meta?.getBoundingClientRect();
      const db = dock?.getBoundingClientRect();
      const feedShown = !!feed && getComputedStyle(feed).display !== "none";
      const dockShown = !!dock && getComputedStyle(dock).display !== "none";
      const scrollers = [];
      let node = brief?.parentElement ?? null;
      while (node && node !== document.body) {
        const s = getComputedStyle(node);
        if ((s.overflowY === "auto" || s.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 1)
          scrollers.push({ cls: node.className.toString().slice(0, 80), gap: node.scrollHeight - node.clientHeight });
        node = node.parentElement;
      }
      return {
        id: pane.dataset.paneId,
        state: pane.dataset.state ?? "",
        focused: pane.classList.contains("focused"),
        paneH: Math.round(pb.height),
        sideInset: bb ? Math.round((bb.left - pb.left) * 10) / 10 : null,
        cardPast: bb ? Math.round((bb.bottom - pb.bottom) * 10) / 10 : null,
        metaGap: mb ? Math.round((pb.bottom - mb.bottom) * 10) / 10 : null,
        metaH: mb ? Math.round(mb.height) : 0,
        metaInside: mb ? mb.top >= pb.top - 1 && mb.bottom <= pb.bottom + 1 && mb.height > 8 : false,
        feedH: feedShown && fb ? Math.round(fb.height) : 0,
        feedScroll: feedShown && feed ? feed.scrollHeight : 0,
        feedItems: feedShown ? feed.querySelectorAll("li").length : 0,
        dockShown,
        dockInside: dockShown && db ? db.top >= pb.top - 1 && db.bottom <= pb.bottom + 1 && db.height > 20 : false,
        dockH: dockShown && db ? Math.round(db.height) : 0,
        logGap: log ? log.scrollHeight - log.clientHeight : 0,
        scrollers,
      };
    });
    return {
      navW: Math.round(navBox.width * 10) / 10,
      navToken: token,
      listH: Math.round(listBox.height),
      listScroll: list.scrollHeight - list.clientHeight,
      visibleRows: rows.filter((r) => r.visible).length,
      rows,
      foot,
      hiddenActs: [...new Set(hiddenActs)],
      panes,
      h1: (document.querySelector(".thread-head h1")?.textContent ?? "").trim(),
      paneName: (stage.querySelector(".pane.focused .pane-name")?.textContent ?? "").trim(),
    };
  });
}

async function reach(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { missing: true };
    const pane = el.closest(".pane");
    const host = pane ?? document.querySelector(".stage");
    let node = el.parentElement;
    while (node && node !== document.body) {
      const s = getComputedStyle(node);
      if ((s.overflowY === "auto" || s.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 1) {
        const er = el.getBoundingClientRect();
        const nr = node.getBoundingClientRect();
        if (er.bottom > nr.bottom - 1) node.scrollTop += er.bottom - nr.bottom + 4;
        if (el.getBoundingClientRect().top < node.getBoundingClientRect().top) node.scrollTop += el.getBoundingClientRect().top - node.getBoundingClientRect().top - 4;
      }
      node = node.parentElement;
    }
    const r = el.getBoundingClientRect();
    const p = host.getBoundingClientRect();
    return {
      missing: false,
      h: Math.round(r.height),
      inside: r.height > 8 && r.top >= p.top - 1 && r.bottom <= p.bottom + 1 && r.left >= p.left - 1 && r.right <= p.right + 1,
      gap: Math.round(p.bottom - r.bottom),
    };
  }, selector);
}

async function cardScroll(page) {
  const sel = ".tab-content:not(.hidden) .pane.focused";
  const read = () => page.evaluate(() => {
    const pane = document.querySelector(".tab-content:not(.hidden) .pane.focused");
    const brief = pane?.querySelector(".pane-brief");
    const dock = pane?.querySelector(".chat-dock");
    const goal = [...(pane?.querySelectorAll(".pane-brief-goal-acts button") ?? [])].filter((b) => !b.disabled).at(-1)
      ?? pane?.querySelector(".pane-brief-goal-acts button");
    const meta = pane?.querySelector(".tc-meta");
    const send = pane?.querySelector(".chat-send");
    const rect = (el) => (el ? el.getBoundingClientRect() : null);
    const over = (a, b) => (a && b ? Math.round(Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : null);
    const visibleOver = (el, host, other) => {
      const a = rect(el);
      const h = rect(host);
      const o = rect(other);
      if (!a || !h || !o) return null;
      const top = Math.max(a.top, h.top);
      const bottom = Math.min(a.bottom, h.bottom);
      if (bottom - top < 1) return 0;
      return Math.round(Math.min(bottom, o.bottom) - Math.max(top, o.top));
    };
    const inside = (el, host) => {
      const a = rect(el);
      const h = rect(host);
      return !!a && !!h && a.height > 8 && a.top >= h.top - 1 && a.bottom <= h.bottom + 1;
    };
    const goalRect = rect(goal);
    const dockRect = rect(dock);
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      sh: brief?.scrollHeight ?? 0,
      ch: brief?.clientHeight ?? 0,
      oy: brief ? getComputedStyle(brief).overflowY : "",
      boxOver: over(rect(brief), dockRect),
      goalOver: over(goalRect, dockRect),
      metaOver: over(rect(meta), dockRect),
      goalVisOver: visibleOver(goal, brief, dock),
      metaVisOver: visibleOver(meta, brief, dock),
      goalIn: inside(goal, brief),
      metaIn: inside(meta, brief),
      sendIn: inside(send, dock) && inside(send, pane),
      dockH: dockRect ? Math.round(dockRect.height) : 0,
      briefH: rect(brief) ? Math.round(rect(brief).height) : 0,
      goalBottom: goalRect ? Math.round(goalRect.bottom) : null,
      dockTop: dockRect ? Math.round(dockRect.top) : null,
    };
  });
  const stop = page.locator(`${sel} .pane-brief-goal-acts button`, { hasText: "Stop goal" });
  const field = page.locator(`${sel} textarea[data-chat-input]`);
  const rest = await read();
  await stop.focus();
  const focused = await read();
  await page.evaluate(() => {
    const brief = document.querySelector(".tab-content:not(.hidden) .pane.focused .pane-brief");
    if (brief) brief.scrollTop = brief.scrollHeight;
  });
  const end = await read();
  await field.fill(`${"steer the running turn\n".repeat(6)}and one more line`);
  await page.waitForTimeout(60);
  const grown = await read();
  await stop.focus();
  const grownFocus = await read();
  const expand = page.locator(`${sel} .chat-expand`);
  await expand.click();
  await page.waitForTimeout(60);
  await stop.focus();
  const expanded = await read();
  await page.locator(`${sel} .chat-expand`).click();
  await field.fill("");
  await page.evaluate(() => {
    const stage = document.querySelector(".tab-content:not(.hidden)");
    for (const brief of stage?.querySelectorAll(".pane-brief") ?? []) brief.scrollTop = 0;
  });
  const others = await page.evaluate(() => {
    const stage = document.querySelector(".tab-content:not(.hidden)");
    return [...stage.querySelectorAll(".pane")].flatMap((pane) => {
      const brief = pane.querySelector(".pane-brief");
      if (!brief || pane.getBoundingClientRect().width < 20) return [];
      const dock = pane.querySelector(".chat-dock");
      const shown = !!dock && getComputedStyle(dock).display !== "none";
      const meta = pane.querySelector(".tc-meta");
      const paneBox = pane.getBoundingClientRect();
      const card = brief.getBoundingClientRect();
      const dockBox = shown ? dock.getBoundingClientRect() : null;
      brief.scrollTop = brief.scrollHeight;
      const foot = meta?.getBoundingClientRect();
      const metaIn = !!foot && foot.height > 8 && foot.top >= card.top - 1 && foot.bottom <= card.bottom + 1;
      const metaOver = dockBox && foot ? Math.round(Math.min(foot.bottom, dockBox.bottom) - Math.max(foot.top, dockBox.top)) : 0;
      brief.scrollTop = 0;
      return [{
        id: pane.dataset.paneId,
        state: pane.dataset.state ?? "",
        focused: pane.classList.contains("focused"),
        oy: getComputedStyle(brief).overflowY,
        sh: brief.scrollHeight,
        ch: brief.clientHeight,
        past: Math.round(card.bottom - paneBox.bottom),
        boxOver: dockBox ? Math.round(Math.min(card.bottom, dockBox.bottom) - Math.max(card.top, dockBox.top)) : 0,
        metaIn,
        metaOver,
      }];
    });
  });
  return { rest, focused, end, grown, grownFocus, expanded, others };
}

function assertCardScroll(vp, card) {
  const { rest, focused, end, grown, grownFocus, expanded, others } = card;
  if (rest.vw !== vp.width || rest.vh !== vp.height) fail(`${vp.name} viewport is ${rest.vw}x${rest.vh}`);
  if (rest.oy !== "auto" && rest.oy !== "scroll") fail(`${vp.name} focused card does not scroll (${rest.oy})`);
  if (rest.boxOver > 1) fail(`${vp.name} composer covers the card by ${rest.boxOver}px`);
  if (rest.goalVisOver > 1 || rest.metaVisOver > 1) fail(`${vp.name} composer covers visible goal or footer (${rest.goalVisOver}, ${rest.metaVisOver})`);
  if (rest.briefH < 40 || rest.dockH < 20 || !rest.sendIn) fail(`${vp.name} focused card lost its composer or its scrollport`);
  if (!focused.goalIn || focused.goalOver > 1) fail(`${vp.name} focusing Stop goal left it under the composer (goal ${focused.goalBottom}, composer ${focused.dockTop})`);
  if (focused.dockH < 20) fail(`${vp.name} focusing the goal removed the composer`);
  if (!end.metaIn || end.metaOver > 1) fail(`${vp.name} scrolling the card left the footer under the composer`);
  if (grown.boxOver > 1 || grown.briefH < 40 || !grown.sendIn) fail(`${vp.name} a taller composer covers the card (${grown.briefH}px card, overlap ${grown.boxOver})`);
  if (!grownFocus.goalIn || grownFocus.goalOver > 1) fail(`${vp.name} with a taller composer, Stop goal stays under it`);
  if (expanded.briefH < 40 || expanded.boxOver > 1 || !expanded.goalIn || expanded.goalOver > 1 || !expanded.sendIn) {
    fail(`${vp.name} expanding the composer covers the goal (card ${expanded.briefH}px, overlap ${expanded.boxOver})`);
  }
  for (const pane of others) {
    if (pane.oy !== "auto" && pane.oy !== "scroll") fail(`${vp.name} ${pane.id} card does not scroll`);
    if (pane.past > 1) fail(`${vp.name} ${pane.id} card passes the pane by ${pane.past}px`);
    if (pane.boxOver > 1) fail(`${vp.name} ${pane.id} composer covers the card by ${pane.boxOver}px`);
    if (!pane.metaIn || pane.metaOver > 1) fail(`${vp.name} ${pane.id} footer is not reachable above the composer`);
  }
}

async function gridAccess(page, vp) {
  const data = await page.evaluate(() => {
    const stage = document.querySelector(".tab-content:not(.hidden)");
    const focused = stage.querySelector(".pane.focused");
    const bar = focused?.querySelector(".chat-card-bar");
    const kids = [...(bar?.children ?? [])].filter((el) => el.getBoundingClientRect().height > 8);
    const tops = kids.map((el) => el.getBoundingClientRect().top);
    const send = focused?.querySelector(".chat-send");
    const dock = focused?.querySelector(".chat-dock");
    const inside = (el, host) => {
      if (!el || !host) return false;
      const a = el.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      return a.height > 8 && a.top >= h.top - 1 && a.bottom <= h.bottom + 1 && a.left >= h.left - 1 && a.right <= h.right + 1;
    };
    const panes = [...stage.querySelectorAll(".pane")].flatMap((pane) => {
      if (pane.getBoundingClientRect().width < 20) return [];
      const card = pane.querySelector(".pane-brief");
      const act = pane.querySelector(".pane-brief-act");
      const meta = pane.querySelector(".tc-meta");
      const name = pane.querySelector(".pane-header.one .pane-name");
      const folder = pane.querySelector(".pane-header.one .pane-crumb-folder");
      const detail = pane.querySelector(".pane-brief-detail");
      const br = card?.getBoundingClientRect();
      const ar = act?.getBoundingClientRect();
      const mr = meta?.getBoundingClientRect();
      const prev = meta?.previousElementSibling?.getBoundingClientRect();
      const shown = dockEl => !!dockEl && getComputedStyle(dockEl).display !== "none";
      const dockEl = pane.querySelector(".chat-dock");
      return [{
        id: pane.dataset.paneId,
        state: pane.dataset.state || "idle",
        focused: pane.classList.contains("focused"),
        paneH: Math.round(pane.getBoundingClientRect().height),
        dockH: shown(dockEl) ? Math.round(dockEl.getBoundingClientRect().height) : 0,
        briefCh: card?.clientHeight ?? 0,
        act: (act?.textContent ?? "").replace(/\s+/g, " ").trim(),
        actIn: !!(ar && br && ar.height > 8 && ar.top >= br.top - 1 && ar.bottom <= br.bottom + 1),
        hole: mr && prev ? Math.round(mr.top - prev.bottom) : 0,
        name: (name?.textContent ?? "").trim(),
        nameCut: !!(name && (name.scrollWidth > name.clientWidth + 1 || name.scrollHeight > name.clientHeight + 2)),
        folderShown: !!(folder && getComputedStyle(folder).display !== "none" && name),
        ph: pane.querySelector("textarea[data-chat-input]")?.getAttribute("placeholder") ?? "",
        detailWeight: detail ? parseInt(getComputedStyle(detail).fontWeight, 10) : 0,
        detailSize: detail ? parseFloat(getComputedStyle(detail).fontSize) : 0,
      }];
    });
    return {
      oneRow: tops.length > 1 && Math.max(...tops) - Math.min(...tops) <= 4,
      barH: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
      sendIn: inside(send, dock) && inside(send, focused),
      briefCh: focused?.querySelector(".pane-brief")?.clientHeight ?? 0,
      dockH: dock ? Math.round(dock.getBoundingClientRect().height) : 0,
      panes,
    };
  });
  if (!data.oneRow || data.barH > 40 || !data.sendIn) fail(`${vp.name} composer bar is ${data.barH}px and not one row`);
  if (vp.name === "1100x700" && (data.briefCh < 100 || data.dockH > 140)) fail(`${vp.name} dock is ${data.dockH}px and the card is ${data.briefCh}px`);
  for (const pane of data.panes) {
    if (pane.hole > 24) fail(`${vp.name} ${pane.id} leaves ${pane.hole}px under its actions`);
    if (pane.act && !pane.actIn) fail(`${vp.name} ${pane.id} ${pane.act} is clipped`);
    if (pane.name && pane.nameCut) fail(`${vp.name} ${pane.id} title is cut: ${pane.name}`);
    if (pane.folderShown) fail(`${vp.name} ${pane.id} header repeats the folder`);
    if (pane.state === "needs_input" && (pane.ph.includes("working") || !pane.ph.toLowerCase().includes("answer"))) fail(`${vp.name} ${pane.id} composer says "${pane.ph}"`);
    if (pane.state === "working" && pane.focused && !pane.ph.includes("steer")) fail(`${vp.name} working composer lost the steer line`);
    if ((pane.state === "idle" || pane.state === "done") && pane.detailWeight >= 600) fail(`${vp.name} ${pane.id} status weighs the same as the question`);
    if ((pane.state === "needs_input" || pane.state === "working") && pane.detailSize > 0 && pane.detailWeight < 600) fail(`${vp.name} ${pane.id} question lost its weight`);
  }
  const title = page.locator(".nav-thread .th-title", { hasText: "Keyboard-accessible settings nav" }).first();
  await title.hover();
  const hover = await page.evaluate(() => {
    const thread = [...document.querySelectorAll(".nav-thread")].find((t) => (t.querySelector(".th-title")?.textContent ?? "").includes("Keyboard-accessible settings nav"));
    const el = thread?.querySelector(".th-title");
    const acts = thread?.querySelector(".nav-thread-actions");
    if (!el || !acts) return { missing: true };
    const tr = el.getBoundingClientRect();
    const ar = acts.getBoundingClientRect();
    const over = Math.min(tr.right, ar.right) - Math.max(tr.left, ar.left);
    const vert = Math.min(tr.bottom, ar.bottom) - Math.max(tr.top, ar.top);
    return {
      missing: false,
      title: el.textContent.trim(),
      over: over > 0 && vert > 0 ? Math.round(over) : 0,
      cut: el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 1,
      shown: getComputedStyle(acts).display,
    };
  });
  await page.mouse.move(0, 0);
  if (hover.missing || hover.shown === "none") fail(`${vp.name} hover actions did not show`);
  else if (hover.over > 1) fail(`${vp.name} hover actions cover ${hover.over}px of the title`);
  else if (hover.cut || hover.title !== "Keyboard-accessible settings nav") fail(`${vp.name} hover cuts the title (${hover.title})`);
  return { barH: data.barH, briefCh: data.briefCh, dockH: data.dockH, panes: data.panes.map((p) => ({ id: p.id, state: p.state, hole: p.hole, actIn: p.actIn, nameCut: p.nameCut, ph: p.ph, detailWeight: p.detailWeight, detailSize: p.detailSize })) };
}

async function shot(page, name) {
  if (!outDir) return;
  mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: resolve(outDir, `${name}.png`) });
}

function assertSidebar(grid) {
  if (Math.abs(grid.navW - 288) > 2) fail(`navigator width ${grid.navW}, expected 288`);
  if (grid.rows.some((r) => r.navOverflow)) fail("a sidebar row paints past the navigator");
  if (grid.visibleRows < 7) fail(`only ${grid.visibleRows} sidebar rows visible at 1440; need at least 7`);
  for (const title of ["Add idempotency keys to refunds", "Keyboard-accessible settings nav"]) {
    const row = grid.rows.find((r) => r.title === title);
    if (!row) fail(`missing sidebar title ${title}`);
    else if (row.titleCut) fail(`sidebar title still cut: ${title} (${row.titleW}px)`);
  }
  const branch = grid.rows.find((r) => r.branch === "aurelia/refund-idempotency");
  if (!branch) fail("missing refunds branch");
  else if (branch.branchCut || branch.branchW < 80) fail(`branch still cut (${branch.branchW}px, cut=${branch.branchCut})`);
  const words = { needs_input: "Needs you", working: "Working", done: "Finished", idle: "Idle", starting: "Starting" };
  for (const row of grid.rows) {
    if (!row.stateClass) continue;
    if (row.stateWord !== words[row.stateClass]) fail(`${row.id} shows ${row.stateClass} as "${row.stateWord || row.glyphLabel || "a glyph"}"`);
  }
  for (const name of ["New thread", "Search threads", "Snoozed", "Settled", "Settings", "Go to", "Files", "Log"]) {
    if (!grid.foot.some((f) => f.name.includes(name) && f.inside)) fail(`sidebar control missing or off-screen: ${name}`);
  }
  for (const name of ["Pin", "Snooze", "Settle"]) {
    if (!grid.hiddenActs.includes(name)) fail(`sidebar action lost its name: ${name}`);
  }
}

function assertOverflow(label, grid) {
  for (const pane of grid.panes) {
    if (pane.feedItems >= 2 && pane.feedH > 0 && pane.feedH < 48 && pane.feedScroll <= pane.feedH + 1) fail(`${label} ${pane.id} step list is ${pane.feedH}px and does not scroll`);
    if (pane.dockShown && !pane.dockInside) fail(`${label} ${pane.id} composer is outside the pane`);
    if (pane.cardPast != null && pane.cardPast > 1) fail(`${label} ${pane.id} card passes the pane by ${pane.cardPast}px`);
    if (!pane.focused && pane.sideInset != null && Math.abs(pane.sideInset - 12) > 2) fail(`${label} ${pane.id} side inset ${pane.sideInset}px`);
  }
}

const LONG_GOAL =
  "Settings nav passes the keyboard test suite, including roving tabindex across every section, focus returning to the composer after Escape closes a picker, a visible focus ring on the active row, and a cold and warm settings-nav run";

async function readGoalCards(page) {
  return page.evaluate(() => {
    const stage = document.querySelector(".tab-content:not(.hidden)") ?? document;
    const nav = document.querySelector(".navigator");
    const cards = [...stage.querySelectorAll(".pane")].flatMap((pane) => {
      if (pane.getBoundingClientRect().width < 20) return [];
      const brief = pane.querySelector(".pane-brief");
      if (!brief) return [];
      brief.scrollTop = 0;
      const br = brief.getBoundingClientRect();
      const dock = pane.querySelector(".chat-dock");
      const dockOn = !!dock && getComputedStyle(dock).display !== "none";
      const db = dockOn ? dock.getBoundingClientRect() : null;
      const text = brief.querySelector(".pane-brief-goal-text");
      const ts = text ? getComputedStyle(text) : null;
      const lineH = ts ? parseFloat(ts.lineHeight) : 0;
      const textH = text ? text.getBoundingClientRect().height : 0;
      const feed = brief.querySelector(".pane-brief-feed");
      const feedOn = !!feed && getComputedStyle(feed).display !== "none";
      const fr = feedOn ? feed.getBoundingClientRect() : null;
      const vis = (a, h) => (a && h ? Math.max(0, Math.min(a.bottom, h.bottom) - Math.max(a.top, h.top)) : 0);
      const send = pane.querySelector(".chat-send");
      const bar = pane.querySelector(".chat-card-bar");
      const barKids = [...(bar?.children ?? [])].filter((el) => el.getBoundingClientRect().height > 8);
      const tops = barKids.map((el) => el.getBoundingClientRect().top);
      const pb = pane.getBoundingClientRect();
      return [{
        id: pane.dataset.paneId,
        focused: pane.classList.contains("focused"),
        paneW: Math.round(pb.width * 100) / 100,
        paneH: Math.round(pb.height * 100) / 100,
        ch: brief.clientHeight,
        sh: brief.scrollHeight,
        st: brief.scrollTop,
        tab: brief.getAttribute("tabindex"),
        role: brief.getAttribute("role"),
        name: brief.getAttribute("aria-label"),
        acts: [...brief.querySelectorAll(".pane-brief-goal-acts button")].map((b) => {
          const r = b.getBoundingClientRect();
          return {
            name: b.textContent.trim(),
            disabled: b.disabled,
            inside: r.height > 8 && r.top >= br.top - 0.5 && r.bottom <= br.bottom + 0.5 && r.left >= br.left - 0.5 && r.right <= br.right + 0.5,
            dockOver: db ? Math.round(Math.min(r.bottom, db.bottom) - Math.max(r.top, db.top)) : 0,
            bottomGap: Math.round((br.bottom - r.bottom) * 10) / 10,
          };
        }),
        lines: lineH ? Math.round((textH / lineH) * 100) / 100 : 0,
        clamp: ts ? ts.getPropertyValue("-webkit-line-clamp") : "",
        title: text?.getAttribute("title") ?? "",
        feedCh: feedOn ? feed.clientHeight : null,
        feedVis: feedOn ? Math.round(vis(fr, br) * 10) / 10 : null,
        feedItems: feedOn ? feed.querySelectorAll("li").length : 0,
        dockH: db ? Math.round(db.height) : 0,
        sendIn: !!(send && db && send.getBoundingClientRect().height > 8 && send.getBoundingClientRect().top >= db.top - 1 && send.getBoundingClientRect().bottom <= db.bottom + 1 && send.getBoundingClientRect().bottom <= pb.bottom + 1),
        oneRow: tops.length < 2 || Math.max(...tops) - Math.min(...tops) <= 4,
      }];
    });
    return {
      inner: [window.innerWidth, window.innerHeight],
      theme: document.documentElement.getAttribute("data-theme"),
      navW: nav ? Math.round(nav.getBoundingClientRect().width) : 0,
      cards,
    };
  });
}

function assertGoalCards(label, data) {
  for (const card of data.cards) {
    for (const act of card.acts) {
      if (!act.inside) fail(`${label} ${card.id} ${act.name} is outside the card at scrollTop 0 (gap ${act.bottomGap}px)`);
      if (act.dockOver > 1) fail(`${label} ${card.id} ${act.name} overlaps the composer by ${act.dockOver}px`);
    }
    if (card.title) {
      if (card.clamp !== "2") fail(`${label} ${card.id} goal text is not clamped to two lines (${card.clamp})`);
      if (!(card.lines <= 2.2)) fail(`${label} ${card.id} goal text is ${card.lines} lines`);
      if (!card.title.length) fail(`${label} ${card.id} goal text has no title`);
    }
    if (card.feedItems > 0) {
      if (card.feedCh < 32) fail(`${label} ${card.id} step list is ${card.feedCh}px`);
      if (card.feedVis < 32) fail(`${label} ${card.id} step list shows ${card.feedVis}px in the first viewport`);
    }
    const overflows = card.sh > card.ch + 1;
    if (overflows) {
      if (card.tab !== "0") fail(`${label} ${card.id} card scrolls but is not a tab stop`);
      if (card.role !== "region" || !card.name) fail(`${label} ${card.id} scrolling card has no name (${card.role}, ${card.name})`);
    } else if (card.tab !== null) {
      fail(`${label} ${card.id} card does not scroll but is a tab stop`);
    }
    if (card.focused && card.dockH) {
      if (card.dockH < 90 || card.dockH > 140) fail(`${label} composer dock is ${card.dockH}px`);
      if (!card.sendIn) fail(`${label} send is outside the composer`);
      if (!card.oneRow) fail(`${label} composer bar wrapped`);
    }
  }
  const focused = data.cards.find((c) => c.focused);
  if (label.startsWith("1100x700") && focused) {
    if (Math.abs(focused.paneH - 302.5) > 8) fail(`${label} focused pane height ${focused.paneH}`);
    if (data.navW > 0 && Math.abs(focused.paneW - 270) > 12) fail(`${label} focused pane width ${focused.paneW}`);
    if (data.navW === 0 && Math.abs(focused.paneW - 366) > 16) fail(`${label} collapsed focused pane width ${focused.paneW}`);
  }
}

async function scrollFromTop(page, selector, key) {
  await page.locator(selector).focus();
  await page.evaluate((sel) => {
    document.querySelector(sel).scrollTop = 0;
  }, selector);
  await page.keyboard.press(key);
  return page.evaluate((sel) => document.querySelector(sel).scrollTop, selector);
}

async function goalMatrix(browser, base) {
  const shots = [];
  const viewports = [
    [1100, 700, "dark", "expanded"],
    [1100, 700, "dark", "collapsed"],
    [1100, 700, "light", "expanded"],
    [1100, 700, "light", "collapsed"],
    [1440, 900, "dark", "expanded"],
    [1440, 900, "dark", "collapsed"],
    [1440, 900, "light", "expanded"],
    [1440, 900, "light", "collapsed"],
  ];
  for (const [w, h, theme, side] of viewports) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", deviceScaleFactor: 1, colorScheme: theme });
    const page = await context.newPage();
    await prepare(page, base, `theme=${theme}&view=threads`);
    if (side === "collapsed") {
      await page.getByRole("button", { name: "Sidebar", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector(".navigator"));
    }
    const label = `${w}x${h}-${theme}-grid-${side}`;
    const data = await readGoalCards(page);
    report.goalCards[label] = data;
    if (data.inner[0] !== w || data.inner[1] !== h) fail(`${label} inner is ${data.inner.join("x")}`);
    if (data.theme !== theme) fail(`${label} theme is ${data.theme}`);
    assertGoalCards(label, data);
    if (outDir) {
      const path = resolve(outDir, `${label}.png`);
      await page.screenshot({ path });
      shots.push(path);
    }
    if (label === "1100x700-dark-grid-expanded") {
      const brief = ".tab-content:not(.hidden) .pane.focused .pane-brief";
      const stop = page.locator(`${brief} .pane-brief-goal-acts button`, { hasText: "Stop goal" });
      await stop.focus();
      const held = await page.evaluate(() => {
        const el = document.querySelector(".tab-content:not(.hidden) .pane.focused .pane-brief");
        const b = document.activeElement;
        const er = el.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return { st: el.scrollTop, name: b.textContent.trim(), inside: br.top >= er.top - 0.5 && br.bottom <= er.bottom + 0.5 };
      });
      report.goalCards.stopFocus = held;
      if (held.st !== 0 || held.name !== "Stop goal" || !held.inside) fail(`focusing Stop goal left the card at ${held.st} (${held.name})`);
      for (const key of ["PageDown", "ArrowDown", "Space"]) {
        const top = await scrollFromTop(page, brief, key);
        report.goalCards[key] = top;
        if (!(top > 0)) fail(`${key} left the card at scrollTop ${top}`);
      }
      const check = await page.evaluate(() => {
        const b = document.querySelector(".tab-content:not(.hidden) .pane.focused .pane-brief-goal-acts button");
        b.click();
        return b.disabled;
      });
      if (!check) fail("Check now was enabled while the thread is working");
    }
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1100, height: 700 }, reducedMotion: "reduce", deviceScaleFactor: 1, colorScheme: "dark" });
    const page = await context.newPage();
    await prepare(page, base, "theme=dark&view=threads");
    await page.evaluate(async (text) => {
      const mod = await import("/src/store/layout.ts");
      const cur = mod.useLayout.getState().panes.p2.goal;
      mod.useLayout.getState().updatePane("p2", { goal: { ...cur, text } });
      mod.useLayout.getState().focusPane("p1");
    }, LONG_GOAL);
    await page.waitForFunction(() => (document.querySelector('.pane[data-pane-id="p2"] .pane-brief-goal-text')?.getAttribute("title") ?? "").includes("cold and warm"));
    const data = await readGoalCards(page);
    report.goalCards.long = data.cards.find((c) => c.id === "p2");
    const card = report.goalCards.long;
    if (!card || card.focused) fail("long goal card was not the unfocused p2");
    if (!card.title.includes("cold and warm") || card.lines > 2.2) fail(`long goal is ${card.lines} lines`);
    if (card.feedCh < 32 || card.feedVis < 32) fail(`long goal feed is ${card.feedCh}px, ${card.feedVis}px visible`);
    if (!card.acts.some((a) => a.name === "Stop goal" && a.inside)) fail("Stop goal is outside the long card at scrollTop 0");
    const sel = '.pane[data-pane-id="p2"] .pane-brief';
    const top = await scrollFromTop(page, sel, "PageDown");
    report.goalCards.longPageDown = top;
    if (!(top > 0)) fail(`PageDown on the long card left scrollTop ${top}`);
    await page.locator(`${sel} .pane-brief-goal-acts button`, { hasText: "Stop goal" }).focus();
    const back = await page.evaluate(() => {
      const brief = document.querySelector('.pane[data-pane-id="p2"] .pane-brief');
      const b = document.activeElement;
      const er = brief.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.top >= er.top - 1 && br.bottom <= er.bottom + 1;
    });
    if (!back) fail("Stop goal was not reachable after PageDown");
    if (outDir) await page.screenshot({ path: resolve(outDir, "1100x700-dark-grid-p2-long-goal-unfocused.png") });
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1100, height: 700 }, reducedMotion: "reduce", deviceScaleFactor: 1, colorScheme: "dark" });
    const page = await context.newPage();
    await prepare(page, base, "theme=dark&view=threads");
    await page.locator(".tab-content:not(.hidden) .pane.focused .pane-brief-goal-acts button", { hasText: "Stop goal" }).click();
    await page.waitForFunction(() => !document.querySelector(".tab-content:not(.hidden) .pane.focused .pane-brief-goal-lead"));
    const why = await page.evaluate(async () => {
      const mod = await import("/src/store/layout.ts");
      return mod.useLayout.getState().panes.p2.goal?.ended?.why ?? "";
    });
    report.goalCards.mouseStop = why;
    if (why !== "stopped") fail(`clicking Stop goal ended the goal as "${why}"`);
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1100, height: 700 }, reducedMotion: "reduce", deviceScaleFactor: 1, colorScheme: "dark" });
    const page = await context.newPage();
    await prepare(page, base, "theme=dark&view=threads");
    const stop = page.locator(".tab-content:not(.hidden) .pane.focused .pane-brief-goal-acts button", { hasText: "Stop goal" });
    await stop.focus();
    const st = await page.evaluate(() => document.querySelector(".tab-content:not(.hidden) .pane.focused .pane-brief").scrollTop);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.querySelector(".tab-content:not(.hidden) .pane.focused .pane-brief-goal-lead"));
    const why = await page.evaluate(async () => {
      const mod = await import("/src/store/layout.ts");
      return mod.useLayout.getState().panes.p2.goal?.ended?.why ?? "";
    });
    report.goalCards.keyStop = { st, why };
    if (st !== 0 || why !== "stopped") fail(`Enter on Stop goal (scroll ${st}) ended the goal as "${why}"`);
    await context.close();
  }

  for (const [w, h] of [[1100, 700], [1440, 900]]) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", deviceScaleFactor: 1, colorScheme: "dark" });
    const page = await context.newPage();
    await prepare(page, base, "theme=dark&view=threads&single=1");
    const single = await page.evaluate(() => {
      const stage = document.querySelector(".tab-content:not(.hidden)");
      const visible = [...stage.querySelectorAll(".pane")].filter((p) => p.getBoundingClientRect().width > 20 && p.getBoundingClientRect().height > 20);
      const pane = visible.find((p) => p.classList.contains("focused")) ?? visible[0];
      const pr = pane.getBoundingClientRect();
      const field = pane.querySelector("textarea[data-chat-input]");
      const fr = field?.getBoundingClientRect();
      const stop = [...pane.querySelectorAll("button")].find((b) => b.textContent.trim() === "Stop" && b.getBoundingClientRect().height > 8);
      const sr = stop?.getBoundingClientRect();
      return {
        panes: visible.length,
        brief: !!pane.querySelector(".pane-brief"),
        placeholder: field?.getAttribute("placeholder") ?? "",
        fieldIn: !!fr && fr.height > 8 && fr.top >= pr.top - 1 && fr.bottom <= pr.bottom + 1,
        stopIn: !stop || (!!sr && sr.top >= pr.top - 1 && sr.bottom <= pr.bottom + 1),
        tall: pr.height > 500,
      };
    });
    report.goalCards[`single-${w}x${h}`] = single;
    if (single.panes !== 1) fail(`${w}x${h} single view shows ${single.panes} panes`);
    if (single.brief) fail(`${w}x${h} single view rendered a grid card`);
    if (!single.tall) fail(`${w}x${h} single pane is not the full column`);
    if (!single.fieldIn) fail(`${w}x${h} single composer is outside the pane`);
    if (!single.stopIn) fail(`${w}x${h} single view Stop is outside the pane`);
    if (!single.placeholder) fail(`${w}x${h} single composer has no placeholder`);
    if (outDir) await page.screenshot({ path: resolve(outDir, `${w}x${h}-dark-single-expanded.png`) });
    await context.close();
  }
  return shots;
}

const LONG_MODEL = "Claude Opus 4.5 (1M context, extra thinking)";
const LONG_DESC = "OpenCode Go · most capable, for the hardest long problems";

async function readOpenPick(page, kind) {
  return page.evaluate((kind) => {
    const pane = document.querySelector(".tab-content:not(.hidden) .pane.focused");
    const pick = kind === "fold" ? pane.querySelector(".chat-pick-fold") : pane.querySelector(".chat-card-end > .chat-pick");
    const btn = pick.querySelector(".chat-pick-btn");
    const menu = pick.querySelector(".chat-pick-menu");
    const span = btn.querySelector(":scope > span");
    const br = btn.getBoundingClientRect();
    const mr = menu.getBoundingClientRect();
    const pr = pane.getBoundingClientRect();
    const fold = pane.querySelector(".chat-pick-fold .chat-pick-btn")?.getBoundingClientRect();
    const plus = pane.querySelector(".chat-plus")?.getBoundingClientRect();
    const over = (el) => !el || !el.textContent.trim() ? null : ({
      text: el.textContent.trim(),
      cut: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
    });
    return {
      label: span?.textContent?.trim() ?? "",
      spanCut: !!span && span.scrollWidth > span.clientWidth + 1,
      btnL: Math.round(br.left * 10) / 10,
      btnW: Math.round(br.width * 10) / 10,
      menuL: Math.round(mr.left * 10) / 10,
      menuR: Math.round(mr.right * 10) / 10,
      menuT: Math.round(mr.top * 10) / 10,
      menuH: Math.round(mr.height * 10) / 10,
      menuW: Math.round(mr.width * 10) / 10,
      paneL: Math.round(pr.left * 10) / 10,
      paneT: Math.round(pr.top * 10) / 10,
      paneB: Math.round(pr.bottom * 10) / 10,
      paneR: Math.round(pr.right * 10) / 10,
      foldL: fold ? Math.round(fold.left * 10) / 10 : null,
      plusL: plus ? Math.round(plus.left * 10) / 10 : null,
      title: btn.getAttribute("title") ?? "",
      aria: btn.getAttribute("aria-label"),
      items: [...menu.querySelectorAll("[role=option]")].map((opt) => ({
        name: over(opt.querySelector(".chat-pick-name")),
        desc: over(opt.querySelector(".chat-pick-desc")),
        title: opt.getAttribute("title"),
        aria: opt.getAttribute("aria-label"),
      })),
    };
  }, kind);
}

async function openPick(page, kind) {
  const sel = kind === "fold"
    ? ".tab-content:not(.hidden) .pane.focused .chat-pick-fold .chat-pick-btn"
    : ".tab-content:not(.hidden) .pane.focused .chat-card-end > .chat-pick .chat-pick-btn";
  await page.locator(sel).click();
  await page.waitForSelector(`${sel.split(" .chat-pick-btn")[0]} .chat-pick-menu`);
}

function assertAnchored(label, kind, data) {
  const delta = Math.abs(data.menuL - data.btnL);
  if (delta > 1) fail(`${label} ${kind} menu left ${data.menuL} is ${delta}px from its trigger ${data.btnL}`);
  if (data.menuR > data.paneR + 1) fail(`${label} ${kind} menu passes the pane by ${Math.round((data.menuR - data.paneR) * 10) / 10}px`);
  if (data.menuT < data.paneT - 1) fail(`${label} ${kind} menu starts ${data.menuT} above the pane ${data.paneT}`);
  if (data.menuH < 80) fail(`${label} ${kind} menu is only ${data.menuH}px tall`);
  if (kind === "model" && data.foldL != null && Math.abs(data.menuL - data.foldL) < 8) {
    fail(`${label} model menu is on the account control (${data.menuL} vs ${data.foldL})`);
  }
  if (kind === "fold" && data.plusL != null && Math.abs(data.menuL - data.plusL) + 1 < Math.abs(data.menuL - data.btnL)) {
    fail(`${label} provider menu is closer to the add button than its own trigger`);
  }
  for (const item of data.items) {
    const name = item.name?.text ?? "";
    const desc = item.desc?.text ?? "";
    if (!item.name?.cut && !item.desc?.cut) continue;
    if (name && !item.title?.includes(name)) fail(`${label} ${kind} cut row "${name}" title is "${item.title}"`);
    if (desc && !item.title?.includes(desc)) fail(`${label} ${kind} cut row drops its subtitle "${desc}"`);
    if (name && !item.aria?.includes(name)) fail(`${label} ${kind} cut row "${name}" has no accessible name`);
    if (desc && !item.aria?.includes(desc)) fail(`${label} ${kind} accessible name misses "${desc}"`);
  }
}

async function pickerMatrix(browser, base) {
  const viewports = [
    [1100, 700, "dark", "expanded"],
    [1100, 700, "dark", "collapsed"],
    [1100, 700, "light", "expanded"],
    [1100, 700, "light", "collapsed"],
    [1440, 900, "dark", "expanded"],
    [1440, 900, "dark", "collapsed"],
    [1440, 900, "light", "expanded"],
    [1440, 900, "light", "collapsed"],
  ];
  for (const [w, h, theme, side] of viewports) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", deviceScaleFactor: 1, colorScheme: theme });
    const page = await context.newPage();
    await prepare(page, base, `theme=${theme}&view=threads`);
    if (side === "collapsed") {
      await page.getByRole("button", { name: "Sidebar", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector(".navigator"));
    }
    const label = `${w}x${h}-${theme}-grid-${side}`;
    const modelBtn = page.locator(".tab-content:not(.hidden) .pane.focused .chat-card-end > .chat-pick .chat-pick-btn");

    await openPick(page, "model");
    const before = await readOpenPick(page, "model");
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "option");
    const first = await page.evaluate(() => document.activeElement?.querySelector(".chat-pick-name")?.textContent?.trim() ?? "");
    await page.keyboard.press("ArrowDown");
    const next = await page.evaluate(() => document.activeElement?.querySelector(".chat-pick-name")?.textContent?.trim() ?? "");
    if (!first || !next || first === next) fail(`${label} ArrowDown stayed on "${first}"`);
    await page.keyboard.press("Escape");
    await page.waitForSelector(".tab-content:not(.hidden) .pane.focused .chat-card-end .chat-pick-menu", { state: "detached" });

    await openPick(page, "model");
    await page.evaluate(() => {
      const menu = document.querySelector(".tab-content:not(.hidden) .chat-card-end .chat-pick-menu");
      const el = [...menu.querySelectorAll(".chat-pick-name")].find((n) => n.textContent.trim() === "Auto");
      el.closest("button").click();
    });
    await page.waitForFunction(() => document.querySelector(".tab-content:not(.hidden) .pane.focused .chat-card-end .chat-pick-btn span")?.textContent?.includes("Auto"));
    await openPick(page, "model");
    const short = await readOpenPick(page, "model");
    await page.keyboard.press("Escape");

    await page.waitForFunction(async () => {
      const id = document.querySelector(".tab-content:not(.hidden) .pane.focused")?.dataset.paneId;
      const { useChat } = await import("/src/lib/chat.ts");
      return !!(id && useChat.getState().byPane[id]);
    });
    await page.evaluate(async ({ value, displayName, description }) => {
      const id = document.querySelector(".tab-content:not(.hidden) .pane.focused")?.dataset.paneId;
      const { useChat } = await import("/src/lib/chat.ts");
      const cur = useChat.getState().byPane[id];
      if (!cur) throw new Error(`no chat session for ${id}`);
      useChat.setState({ byPane: { ...useChat.getState().byPane, [id]: { ...cur, models: [{ value, displayName, description }] } } });
    }, { value: "opus-long", displayName: LONG_MODEL, description: LONG_DESC });
    await openPick(page, "model");
    await page.evaluate((name) => {
      const menu = document.querySelector(".tab-content:not(.hidden) .chat-card-end .chat-pick-menu");
      const el = [...menu.querySelectorAll(".chat-pick-name")].find((n) => n.textContent.trim() === name);
      el.closest("button").click();
    }, LONG_MODEL);
    await page.waitForFunction((name) => document.querySelector(".tab-content:not(.hidden) .pane.focused .chat-card-end .chat-pick-btn span")?.textContent?.includes(name), LONG_MODEL);
    await openPick(page, "model");
    const long = await readOpenPick(page, "model");
    if (outDir && label === "1100x700-dark-grid-expanded") {
      await page.screenshot({ path: resolve(outDir, "1100x700-dark-model-menu.png") });
    }
    await page.keyboard.press("Escape");

    await openPick(page, "fold");
    const fold = await readOpenPick(page, "fold");
    await page.keyboard.press("Escape");

    report.picker[label] = {
      before: { label: before.label, btnL: before.btnL, btnW: before.btnW, menuL: before.menuL, menuW: before.menuW, spanCut: before.spanCut },
      short: { label: short.label, btnL: short.btnL, btnW: short.btnW, menuL: short.menuL, menuW: short.menuW, spanCut: short.spanCut },
      long: { label: long.label, btnL: long.btnL, btnW: long.btnW, menuL: long.menuL, menuW: long.menuW, spanCut: long.spanCut, title: long.title, aria: long.aria },
      fold: { btnL: fold.btnL, menuL: fold.menuL, menuW: fold.menuW, plusL: fold.plusL },
    };
    for (const snap of [before, short, long]) assertAnchored(label, "model", snap);
    assertAnchored(label, "fold", fold);
    if (Math.abs(before.menuL - short.menuL) > 2 || Math.abs(short.menuL - long.menuL) > 2) {
      fail(`${label} menu left moved ${before.menuL} -> ${short.menuL} -> ${long.menuL}`);
    }
    if (before.label === short.label || short.label === long.label) fail(`${label} labels did not change (${before.label} / ${short.label} / ${long.label})`);
    if (!long.label.includes(LONG_MODEL)) fail(`${label} long label is "${long.label}"`);
    if (label.startsWith("1100x700") && !long.spanCut) fail(`${label} long model name is not truncated on the button`);
    if (long.spanCut && (!long.title.includes(LONG_MODEL) || !long.aria?.includes(LONG_MODEL))) fail(`${label} long name is missing from the button title or name`);
    const longRow = long.items.find((item) => item.name?.text === LONG_MODEL);
    if (!longRow) fail(`${label} long model is not in the menu`);
    else if (longRow.name.cut || longRow.desc?.cut) {
      if (!longRow.title?.includes(LONG_MODEL) || !longRow.title.includes(LONG_DESC)) fail(`${label} cut menu row title is "${longRow.title}"`);
      if (!longRow.aria?.includes(LONG_MODEL) || !longRow.aria.includes(LONG_DESC)) fail(`${label} cut menu row name is "${longRow.aria}"`);
    }

    if (long.spanCut) {
      await page.evaluate(async (text) => {
        const mod = await import("/src/store/layout.ts");
        const id = document.querySelector(".tab-content:not(.hidden) .pane.focused")?.dataset.paneId;
        const cur = mod.useLayout.getState().panes[id]?.goal;
        if (cur) mod.useLayout.getState().updatePane(id, { goal: { ...cur, text } });
      }, LONG_GOAL);
      await modelBtn.hover();
      await page.waitForFunction(() => {
        const tip = document.querySelector(".tab-content:not(.hidden) .pane.focused .chat-card-end > .chat-pick .chat-pick-tip");
        return !!tip?.classList.contains("on") && tip.getBoundingClientRect().height > 8;
      });
      const hover = await page.evaluate(() => {
        const btn = document.querySelector(".tab-content:not(.hidden) .pane.focused .chat-card-end > .chat-pick .chat-pick-btn");
        const tip = btn.querySelector(".chat-pick-tip");
        const paneEl = btn.closest(".pane");
        const pane = paneEl.getBoundingClientRect();
        const r = tip.getBoundingClientRect();
        const cs = getComputedStyle(tip);
        const hit = (el) => {
          if (!el) return false;
          const b = el.getBoundingClientRect();
          if (b.width < 1 || b.height < 1) return false;
          return r.left < b.right - 0.5 && r.right > b.left + 0.5 && r.top < b.bottom - 0.5 && r.bottom > b.top + 0.5;
        };
        return {
          on: tip.classList.contains("on"),
          display: cs.display,
          text: tip.textContent.trim(),
          wrapped: tip.scrollHeight <= tip.clientHeight + 1 && tip.scrollWidth <= tip.clientWidth + 1,
          inside: r.width > 40 && r.height > 8 && r.left >= pane.left - 1 && r.right <= pane.right + 1 && r.top >= pane.top - 1 && r.bottom <= pane.bottom + 1,
          coversActs: [...paneEl.querySelectorAll(".pane-brief-goal-acts button")].some(hit),
          coversGoal: hit(paneEl.querySelector(".pane-brief-goal-text")),
          coversField: hit(paneEl.querySelector(".chat-card textarea")),
          box: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        };
      });
      report.picker[label].hover = hover;
      if (!hover.on || hover.display === "none" || !hover.text.includes(LONG_MODEL)) fail(`${label} hover tip is "${hover.text}"`);
      if (!hover.wrapped) fail(`${label} hover tip clips the full label`);
      if (!hover.inside) fail(`${label} hover tip is outside the pane ${JSON.stringify(hover.box)}`);
      if (hover.coversActs || hover.coversGoal) fail(`${label} hover tip covers the goal actions ${JSON.stringify(hover.box)}`);
      if (hover.coversField) fail(`${label} hover tip covers the composer field ${JSON.stringify(hover.box)}`);
      await page.evaluate(() => {
        const btn = document.querySelector(".tab-content:not(.hidden) .pane.focused .chat-card-end > .chat-pick .chat-pick-btn");
        btn.focus({ focusVisible: true });
      });
      await page.waitForFunction(() => document.activeElement?.classList.contains("chat-pick-btn") && document.querySelector(".tab-content:not(.hidden) .pane.focused .chat-card-end > .chat-pick .chat-pick-tip")?.classList.contains("on"));
      const focus = await page.evaluate(() => {
        const btn = document.querySelector(".tab-content:not(.hidden) .pane.focused .chat-card-end > .chat-pick .chat-pick-btn");
        const tip = btn.querySelector(".chat-pick-tip");
        return { on: tip.classList.contains("on"), text: tip.textContent.trim(), active: document.activeElement === btn };
      });
      report.picker[label].focus = focus;
      if (!focus.active || !focus.on || !focus.text.includes(LONG_MODEL)) fail(`${label} keyboard tip is "${focus.text}" (active ${focus.active})`);
    }
    await context.close();
  }
}

async function visibleMenuWords(page) {
  return page.evaluate(() => {
    const pane = document.querySelector(".tab-content:not(.hidden) .pane.focused");
    const menu = pane?.querySelector(".chat-card-end .chat-pick-menu");
    const button = pane?.querySelector(".chat-card-end .chat-pick-btn");
    if (!menu || !button) return { missing: true };
    const mr = menu.getBoundingClientRect();
    const br = button.getBoundingClientRect();
    const pr = pane.getBoundingClientRect();
    const words = [...menu.querySelectorAll("button[role=option]")].flatMap((b) => {
      const r = b.getBoundingClientRect();
      const top = Math.max(r.top, mr.top);
      const bot = Math.min(r.bottom, mr.bottom);
      if (bot - top < 8) return [];
      const x = Math.min(mr.right - 8, Math.max(mr.left + 8, r.left + 16));
      const y = top + (bot - top) / 2;
      const hit = document.elementFromPoint(x, y);
      const name = b.querySelector(".chat-pick-name")?.textContent?.trim() ?? "";
      return [{ name, owns: !!(hit && b.contains(hit)) }];
    });
    return {
      paneW: Math.round(pr.width),
      btnW: Math.round(br.width * 10) / 10,
      menuW: Math.round(mr.width * 10) / 10,
      menuL: Math.round(mr.left),
      btnL: Math.round(br.left),
      words,
    };
  });
}

/** One column (the grid folded) and two columns, sidebar open. A short model control must still have clickable menu words. */
async function narrowMenus(browser, base) {
  const cases = [
    { w: 800, h: 900, note: "800 one-column" },
    { w: 1100, h: 700, note: "1100 two-column", tab: "t2", focus: "p8" },
    { w: 880, h: 700, note: "880 two-column", tab: "t2", focus: "p8" },
  ];
  for (const c of cases) {
    const context = await browser.newContext({ viewport: { width: c.w, height: c.h }, reducedMotion: "reduce", deviceScaleFactor: 1, colorScheme: "dark" });
    const page = await context.newPage();
    await prepare(page, base, "theme=dark&view=threads");
    if (!(await page.locator(".navigator").count())) fail(`${c.note} sidebar is closed`);
    if (c.tab) {
      await page.evaluate(async ({ tab, focus }) => {
        const { useLayout } = await import("/src/store/layout.ts");
        useLayout.getState().activateTab(tab);
        if (focus) useLayout.getState().focusPane(focus);
      }, c);
      await page.waitForTimeout(200);
    }
    await openPick(page, "model");
    const info = await visibleMenuWords(page);
    report.picker[c.note] = info;
    if (info.missing) fail(`${c.note} model menu did not open`);
    else {
      if (info.menuW < 48) fail(`${c.note} menu is ${info.menuW}px wide`);
      const missed = info.words.filter((w) => !w.owns).map((w) => w.name);
      if (!info.words.length) fail(`${c.note} menu has no visible words`);
      if (missed.length) fail(`${c.note} menu words are not clickable: ${missed.join(", ")} (button ${info.btnW}px, menu ${info.menuW}px)`);
      if (Math.abs(info.menuL - info.btnL) > 2) fail(`${c.note} menu left ${info.menuL} left its trigger ${info.btnL}`);
    }
    await context.close();
  }
}

const LAUNCH = "bili --host 127.0.0.1 --no-auto-update --bin <claude> claude";
const COMPRESSION_STATES = [
  ["", "Not installed"],
  ["on", "No active compression proxy"],
  ["unavailable", "Installed, but unavailable"],
  ["active", "Compressing 1 new thread for work"],
  ["failed", "was not left on plain Claude"],
];

function hexOf(color) {
  const m = String(color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return "";
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

/** Real Settings → Accounts, including the bundled untangle skill and every compression state. */
async function compressionMatrix(browser, base) {
  report.compression = {};
  const sizes = [
    [1440, 900],
    [1100, 700],
    [800, 900],
  ];
  for (const theme of ["dark", "light"]) {
    for (const [w, h] of sizes) {
      const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", deviceScaleFactor: 1, colorScheme: theme });
      const page = await context.newPage();
      for (const [mode, expectStatus] of COMPRESSION_STATES) {
        const label = `${theme} ${w}x${h} ${mode || "absent"}`;
        const query = `theme=${theme}&view=settings&section=accounts${mode ? `&compress=${mode}` : ""}`;
        await prepare(page, base, query);
        await page.waitForFunction(() => [...document.querySelectorAll("h3")].some((el) => el.textContent === "Long-session compression"));
        const measured = await page.evaluate(() => {
          const opaque = (node) => {
            let el = node;
            while (el) {
              const c = getComputedStyle(el).backgroundColor;
              const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
              if (m && (m[4] === undefined || Number(m[4]) >= 0.99)) return c;
              el = el.parentElement;
            }
            return getComputedStyle(document.body).backgroundColor;
          };
          const content = document.querySelector(".settings-content");
          const group = [...document.querySelectorAll(".set-group")].find((el) => el.querySelector("h3")?.textContent === "Long-session compression");
          const untangle = [...document.querySelectorAll("h3")].some((el) => el.textContent === "Untangle codebase");
          const status = group?.querySelector("[role=status]");
          const code = group?.querySelector("code");
          group?.scrollIntoView({ block: "nearest" });
          const cr = content.getBoundingClientRect();
          const gr = group.getBoundingClientRect();
          return {
            untangle,
            command: code?.textContent?.trim() ?? "",
            status: status?.textContent?.replace(/\s+/g, " ").trim() ?? "",
            overflowX: content.scrollWidth - content.clientWidth,
            sticksOut: gr.right > cr.right + 1 || gr.left < cr.left - 1,
            width: Math.round(gr.width),
            height: Math.round(gr.height),
            fg: getComputedStyle(status).color,
            bg: opaque(status),
            codeFg: getComputedStyle(code).color,
            codeBg: opaque(code),
          };
        });
        report.compression[label] = { ...measured, fg: hexOf(measured.fg), bg: hexOf(measured.bg), codeFg: hexOf(measured.codeFg), codeBg: hexOf(measured.codeBg) };
        if (!measured.untangle) fail(`${label} is missing the untangle skill`);
        if (measured.command !== LAUNCH) fail(`${label} launch wording is "${measured.command}"`);
        if (!measured.status.includes(expectStatus)) fail(`${label} status is "${measured.status}"`);
        if (measured.overflowX > 1 || measured.sticksOut) fail(`${label} compression group overflows (${measured.overflowX}px, sticks ${measured.sticksOut})`);
        const statusRatio = ratio(report.compression[label].fg, report.compression[label].bg);
        const codeRatio = ratio(report.compression[label].codeFg, report.compression[label].codeBg);
        report.compression[label].statusRatio = Math.round(statusRatio * 100) / 100;
        report.compression[label].codeRatio = Math.round(codeRatio * 100) / 100;
        if (statusRatio < 4.5) fail(`${label} status contrast is ${statusRatio.toFixed(2)}:1`);
        if (codeRatio < 4.5) fail(`${label} command contrast is ${codeRatio.toFixed(2)}:1`);
      }
      await context.close();
    }
  }
}

const report = { viewports: {}, interactions: {}, goalCards: {}, picker: {} };

const base = await serve();
const browser = await chromium.launch({ headless: !flag("headed") });
try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      reducedMotion: "reduce",
      deviceScaleFactor: 1,
      colorScheme: "dark",
    });
    const page = await context.newPage();
    await prepare(page, base, "view=threads");
    const grid = await readGrid(page);
    report.viewports[vp.name] = grid;
    await shot(page, `threads-${vp.name}`);
    if (checks.has("sidebar") && vp.name === "1440x900") assertSidebar(grid);
    if (checks.has("sidebar") && vp.name === "1100x700" && grid.visibleRows < 4) fail(`only ${grid.visibleRows} sidebar rows visible at 1100x700; need at least 4`);
    if (checks.has("sidebar")) {
      for (const row of grid.rows) {
        if (row.visible && row.titleCut) fail(`${vp.name} visible title cut: ${row.title}`);
        if (row.visible && row.branchCut) fail(`${vp.name} visible branch cut: ${row.branch}`);
      }
    }
    if (checks.has("overflow")) {
      const card = await cardScroll(page);
      report.cardScroll = report.cardScroll ?? {};
      report.cardScroll[vp.name] = {
        viewport: `${card.rest.vw}x${card.rest.vh}`,
        rest: { sh: card.rest.sh, ch: card.rest.ch, boxOver: card.rest.boxOver, goal: card.rest.goalBottom, dock: card.rest.dockTop },
        focused: { sh: card.focused.sh, ch: card.focused.ch, goal: card.focused.goalBottom, dock: card.focused.dockTop, goalOver: card.focused.goalOver },
        end: { sh: card.end.sh, ch: card.end.ch, metaOver: card.end.metaOver },
        grown: { sh: card.grown.sh, ch: card.grown.ch, briefH: card.grown.briefH, boxOver: card.grown.boxOver },
        expanded: { sh: card.expanded.sh, ch: card.expanded.ch, briefH: card.expanded.briefH, boxOver: card.expanded.boxOver, goalOver: card.expanded.goalOver },
        others: card.others.map((p) => ({ id: p.id, state: p.state, sh: p.sh, ch: p.ch, metaIn: p.metaIn })),
      };
      assertCardScroll(vp, card);
      report.cardScroll[vp.name].access = await gridAccess(page, vp);
      assertOverflow(vp.name, grid);
      for (const pane of grid.panes) {
        const meta = await reach(page, `.pane[data-pane-id="${pane.id}"] .tc-meta`);
        if (!meta.missing && !meta.inside) fail(`${vp.name} ${pane.id} footer not reachable (${meta.gap}px)`);
        const act = await reach(page, `.pane[data-pane-id="${pane.id}"] .pane-brief-act`);
        if (!act.missing && !act.inside) fail(`${vp.name} ${pane.id} action not reachable`);
        const goal = await reach(page, `.pane[data-pane-id="${pane.id}"] .pane-brief-goal-acts button`);
        if (!goal.missing && !goal.inside) fail(`${vp.name} ${pane.id} goal action not reachable`);
      }
    }
    if (vp.name === "1440x900") {
      await page.locator(".th-row").first().focus();
      const first = await page.evaluate(() => document.activeElement?.closest("[data-thread]")?.dataset.thread ?? "");
      await page.keyboard.press("ArrowDown");
      const second = await page.evaluate(() => document.activeElement?.closest("[data-thread]")?.dataset.thread ?? "");
      report.interactions.arrow = { first, second };
      if (checks.has("sidebar") && (!second || second === first)) fail(`ArrowDown did not move sidebar focus (${first} -> ${second})`);
      if (checks.has("sidebar")) {
        const search = page.getByRole("searchbox", { name: "Search threads" });
        await search.fill("zzzz");
        const miss = (await page.locator(".side-empty").textContent()) ?? "";
        report.interactions.search = miss.trim();
        if (!miss.includes("zzzz")) fail(`search miss did not name the query: ${miss}`);
        await page.getByRole("button", { name: "Clear search" }).click();
        const back = await page.locator(".nav-thread .th-row").count();
        if (back < 7) fail(`clearing search left ${back} thread rows`);
      }
      if (checks.has("title")) {
        const goal = await page.locator(".pane-brief-goal").filter({ hasText: "last check failed" }).first().innerText();
        report.interactions.goal = goal.replace(/\s+/g, " ").trim();
        if (!goal.includes("next check runs when this turn ends")) fail(`working goal does not say when the next check runs: ${goal.slice(0, 180)}`);
        const type = await page.evaluate(() => {
          const px = (sel) => {
            const el = document.querySelector(sel);
            return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
          };
          return {
            detail: px(".pane-brief.working .pane-brief-detail"),
            ask: px(".pane-brief.needs_input .pane-brief-detail"),
            state: px(".pane-brief .state-text"),
            meta: px(".pane-brief .tc-meta"),
            goal: px(".pane-brief-goal-text"),
            goalWeight: document.querySelector(".pane-brief-goal-text") ? parseInt(getComputedStyle(document.querySelector(".pane-brief-goal-text")).fontWeight, 10) : 0,
          };
        });
        report.interactions.type = type;
        if (!(type.detail > type.meta && type.ask > type.meta && type.state > type.meta && type.goal >= type.meta && type.goalWeight >= 600)) {
          fail(`activity does not scan ahead of metadata: ${JSON.stringify(type)}`);
        }
      }

      const composer = page.locator(".tab-content:not(.hidden) .pane.focused textarea[data-chat-input]");
      await composer.click();
      await composer.fill("Check the nav with the keyboard");
      report.interactions.typed = await composer.inputValue();
      if (checks.has("overflow") && report.interactions.typed !== "Check the nav with the keyboard") fail("focused composer did not keep the typed text");

      await page.getByRole("button", { name: "Answer", exact: true }).first().click();
      await page.waitForTimeout(80);
      const answered = await page.evaluate(() => {
        const pane = document.querySelector(".tab-content:not(.hidden) .pane.focused");
        const box = pane?.querySelector("textarea[data-chat-input]");
        const dock = pane?.querySelector(".chat-dock");
        const pb = pane.getBoundingClientRect();
        const db = dock?.getBoundingClientRect();
        return {
          id: pane?.dataset.paneId ?? "",
          dockInside: !!db && db.bottom <= pb.bottom + 1 && db.top >= pb.top && db.height > 20,
        };
      });
      report.interactions.answer = answered;
      if (checks.has("overflow") && !answered.dockInside) fail("Answer did not leave a composer inside the focused pane");

      await page.getByRole("button", { name: "Start this thread", exact: true }).first().click();
      await page.waitForTimeout(80);
      const started = await page.evaluate(() => ({
        id: document.querySelector(".tab-content:not(.hidden) .pane.focused")?.dataset.paneId ?? "",
        focused: document.activeElement?.getAttribute("data-chat-input") ?? "",
      }));
      report.interactions.start = started;
      if (checks.has("overflow") && started.focused !== started.id) fail(`Start this thread left focus on ${started.focused || "nothing"} instead of the composer`);
    }
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", deviceScaleFactor: 1, colorScheme: "dark" });
    const page = await context.newPage();
    await prepare(page, base, "view=threads&single=1");
    const single = await readGrid(page);
    report.single = { h1: single.h1, paneName: single.paneName, navW: single.navW };
    await shot(page, "threads-single");
    if (checks.has("title")) {
      if (single.h1 !== "Keyboard-accessible settings nav") fail(`single-thread title is "${single.h1}"`);
      const h1box = await page.evaluate(() => {
        const h = document.querySelector(".thread-head h1");
        const r = h.getBoundingClientRect();
        return { w: Math.round(r.width), cut: h.scrollWidth > h.clientWidth + 1, text: h.textContent.trim() };
      });
      report.single.h1box = h1box;
      if (h1box.w < 80) fail(`location title is only ${h1box.w}px wide`);
      const titles = await page.evaluate(() => [...document.querySelectorAll(".thread-head h1, .pane.focused .pane-name")].map((el) => (el.textContent ?? "").trim()).filter(Boolean));
      report.single.titles = titles;
      if (titles.filter((t) => t === "Keyboard-accessible settings nav").length !== 1) fail(`expected one location title, saw ${JSON.stringify(titles)}`);
      const body = await page.evaluate(() => document.querySelector(".tab-content:not(.hidden) .pane.focused .chat-empty")?.innerText ?? "");
      report.single.body = body.replace(/\s+/g, " ").trim();
      if (body.includes("What should")) fail(`a running thread still asks what to do`);
      if (!body.includes("already running") && !body.includes("Answer in the composer")) fail(`running thread has no guidance: ${body.slice(0, 120)}`);
      const said = await page.evaluate(() => {
        const pane = document.querySelector(".tab-content:not(.hidden) .pane.focused");
        return pane?.querySelector("textarea[data-chat-input]")?.getAttribute("placeholder") ?? "";
      });
      report.single.placeholder = said;
      if (said.includes("Ask anything") || said.includes("A message now goes")) fail(`a running thread's composer still asks what to do: ${said}`);
      if (!said.includes("steer")) fail(`a running thread's composer does not say you can steer it: ${said}`);
    }
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", deviceScaleFactor: 1, colorScheme: "dark" });
    const page = await context.newPage();
    await prepare(page, base, "view=threads");
    await page.locator(".th-title", { hasText: "New thread" }).first().click();
    await page.getByRole("button", { name: "Grid", exact: true }).click();
    await page.waitForTimeout(100);
    const h1 = (await page.locator(".thread-head h1").textContent())?.trim() ?? "";
    report.freshSingle = h1;
    await shot(page, "fresh-single");
    if (checks.has("title") && h1 !== "New thread") fail(`a thread with no name says "${h1}"`);
    await context.close();
  }
  await goalMatrix(browser, base);
  await pickerMatrix(browser, base);
  await narrowMenus(browser, base);
  await compressionMatrix(browser, base);
} finally {
  await browser.close();
  vite?.kill();
}

if (outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "measurements.json"), JSON.stringify(report, null, 2));
}

const brief = {};
for (const [name, grid] of Object.entries(report.viewports)) {
  brief[name] = {
    navW: grid.navW,
    visibleRows: grid.visibleRows,
    h1: grid.h1,
    titles: grid.rows.filter((r) => r.titleCut || r.branchCut || r.title.includes("idempotency") || r.title.includes("Keyboard")).map((r) => ({
      id: r.id, title: r.title, titleCut: r.titleCut, titleW: r.titleW, branch: r.branch, branchW: r.branchW, branchCut: r.branchCut, stateWord: r.stateWord,
    })),
    states: grid.rows.map((r) => `${r.id}:${r.stateWord || r.glyphLabel || "-"}`).join(" "),
    panes: grid.panes.map((p) => ({ id: p.id, state: p.state, focused: p.focused, paneH: p.paneH, sideInset: p.sideInset, cardPast: p.cardPast, metaInside: p.metaInside, metaGap: p.metaGap, feedH: p.feedH, feedItems: p.feedItems, dockInside: p.dockInside, dockShown: p.dockShown })),
  };
}
console.log(JSON.stringify({ brief, cardScroll: report.cardScroll, single: report.single, freshSingle: report.freshSingle, interactions: report.interactions, goalCards: report.goalCards, picker: report.picker, compression: report.compression }, null, 2));
console.log(failures.length ? `layout-contract: ${failures.length} failed` : "layout-contract: ok");
process.exit(failures.length ? 1 : 0);
