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
  await page.goto(`${base}/design/preview/?theme=dark&${query}`, { waitUntil: "domcontentloaded" });
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
    if (pane.feedItems >= 2 && pane.feedH > 0 && pane.feedH < 48) fail(`${label} ${pane.id} step list is ${pane.feedH}px`);
    if (pane.dockShown && !pane.dockInside) fail(`${label} ${pane.id} composer is outside the pane`);
    if (pane.cardPast != null && pane.cardPast > 1) fail(`${label} ${pane.id} card passes the pane by ${pane.cardPast}px`);
    if (!pane.focused && pane.sideInset != null && Math.abs(pane.sideInset - 12) > 2) fail(`${label} ${pane.id} side inset ${pane.sideInset}px`);
  }
}

const report = { viewports: {}, interactions: {} };

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
console.log(JSON.stringify({ brief, single: report.single, freshSingle: report.freshSingle, interactions: report.interactions }, null, 2));
console.log(failures.length ? `layout-contract: ${failures.length} failed` : "layout-contract: ok");
process.exit(failures.length ? 1 : 0);
