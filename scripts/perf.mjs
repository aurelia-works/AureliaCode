// How fast AureliaCode loads and how much it does while idle, measured on the preview harness
// (the real app against a mocked backend where every IPC call takes --ipc-ms, like a trip to Rust).
//   npm run perf -- --out before.json        measure and save
//   npm run perf -- --compare before.json    measure, then print before → after with the change
// Options: --runs 5 (boots, median), --idle 30 (seconds of idle IPC counting), --ipc-ms 4.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const runs = Number(arg("runs", 5));
const idleS = Number(arg("idle", 30));
const ipcMs = Number(arg("ipc-ms", 4));
const out = arg("out");
const compare = arg("compare");
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const round = (n) => Math.round(n * 10) / 10;

// 1. What the window downloads before anything shows: the entry script, its preloads and CSS.
function bundle() {
  const dir = mkdtempSync(join(tmpdir(), "aurelia-perf-"));
  const r = spawnSync("npx", ["vite", "build", "--outDir", dir, "--emptyOutDir", "--logLevel", "error"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`vite build failed: ${r.stderr.slice(-500)}`);
  const html = readFileSync(join(dir, "index.html"), "utf8");
  const refs = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  const gz = (f) => gzipSync(readFileSync(join(dir, f))).length / 1024;
  const all = readdirSync(join(dir, "assets")).filter((f) => f.endsWith(".js"));
  const res = {
    bootJsKb: round(refs.filter((f) => f.endsWith(".js")).reduce((n, f) => n + gz(f), 0)),
    bootCssKb: round(refs.filter((f) => f.endsWith(".css")).reduce((n, f) => n + gz(f), 0)),
    allJsKb: round(all.reduce((n, f) => n + gz(`assets/${f}`), 0)),
    chunks: all.length,
  };
  rmSync(dir, { recursive: true, force: true });
  return res;
}

const port = await new Promise((resolve) => {
  const s = createServer().listen(0, () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve, reject) => {
  const late = setTimeout(() => reject(new Error("vite didn't start within 60s")), 60_000);
  vite.stdout.on("data", (d) => String(d).includes("Local") && (clearTimeout(late), resolve()));
  vite.on("exit", (c) => reject(new Error(`vite exited ${c}`)));
});
const url = (q) => `http://localhost:${port}/design/preview/?${q}&ipcMs=${ipcMs}&perf=1`;

const result = { ipcMs, runs, idleS };
let browser;
try {
  browser = await chromium.launch();
  const marks = (page) =>
    page.evaluate(() => Object.fromEntries(performance.getEntriesByType("mark").filter((m) => m.name.startsWith("boot:")).map((m) => [m.name.slice(5), m.startTime])));
  const waitReady = (page) => page.waitForFunction(() => performance.getEntriesByName("boot:ready").length && performance.getEntriesByName("boot:splash").length, null, { timeout: 30_000 });

  // 2. Boot: a warm-up load fills vite's transform cache, then the median of --runs loads.
  const boots = [];
  for (let i = 0; i <= runs; i++) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url("view=threads"));
    await waitReady(page);
    const m = await marks(page);
    if (i > 0) boots.push(m);
    await page.close();
  }
  const pick = (f) => round(median(boots.map(f)));
  result.boot = {
    bootWorkMs: pick((m) => m.render - m.start), // from boot() starting to the first React render call
    firstPaintMs: pick((m) => m.painted), // page start to the app's first frame
    splashGoneMs: pick((m) => Math.max(m.splash, m.painted)), // page start to the splash fading (it can't fade before the app paints)
  };

  // 3. Idle: IPC calls per minute after the app settles, by command.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url("view=threads"));
    await waitReady(page);
    await page.waitForTimeout(3000);
    const from = await page.evaluate(() => (window.__ipcLog ?? []).length);
    await page.waitForTimeout(idleS * 1000);
    const calls = await page.evaluate((n) => (window.__ipcLog ?? []).slice(n).map((c) => c.cmd), from);
    const by = {};
    for (const c of calls) by[c] = (by[c] ?? 0) + 60 / idleS;
    result.idle = {
      ipcPerMin: round(calls.length * (60 / idleS)),
      byCmd: Object.fromEntries(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, round(v)])),
    };
    await page.close();
  }

  // 4. A replayed chat reply: React render time and long tasks while it streams in.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url("view=chat&replay=fix-arrow-key&replayMs=15"));
    await waitReady(page);
    const box = page.locator("textarea[data-chat-input]").last();
    await box.waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      window.__perfProfile.commits = 0;
      window.__perfProfile.ms = 0;
      window.__long = 0;
      new PerformanceObserver((l) => (window.__long += l.getEntries().length)).observe({ type: "longtask" });
    });
    await box.fill("The right arrow types a box in the composer. Find why and fix it.");
    await page.locator("button.chat-send").last().click();
    await page.getByText(/Worked for/).first().waitFor({ timeout: 15_000 });
    const p = await page.evaluate(() => ({ ...window.__perfProfile, long: window.__long }));
    result.reply = { reactCommits: p.commits, reactMs: round(p.ms), longTasks: p.long };
    await page.close();
  }
} finally {
  await browser?.close();
  vite.kill();
}
result.bundle = bundle();

if (out) writeFileSync(out, JSON.stringify(result, null, 1));
const flat = (r) => ({
  "Boot work before first render (ms)": r.boot.bootWorkMs,
  "Page start → app's first frame (ms)": r.boot.firstPaintMs,
  "Page start → splash gone (ms)": r.boot.splashGoneMs,
  "Idle IPC calls / min": r.idle.ipcPerMin,
  "React render time, one reply (ms)": r.reply.reactMs,
  "React commits, one reply": r.reply.reactCommits,
  "Long tasks, one reply": r.reply.longTasks,
  "JS loaded at boot (KB gzip)": r.bundle.bootJsKb,
  "CSS loaded at boot (KB gzip)": r.bundle.bootCssKb,
});
const now = flat(result);
if (compare) {
  const was = flat(JSON.parse(readFileSync(compare, "utf8")));
  console.log("| Measure | Before | After | Change |\n| --- | --- | --- | --- |");
  for (const [k, v] of Object.entries(now)) {
    const b = was[k];
    const pct = b ? `${Math.round(((v - b) / b) * 100)}%` : "";
    console.log(`| ${k} | ${b} | ${v} | ${pct} |`);
  }
} else {
  for (const [k, v] of Object.entries(now)) console.log(`${k}: ${v}`);
}
console.log("Idle IPC by command (/min):", JSON.stringify(result.idle.byCmd));
