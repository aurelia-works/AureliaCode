#!/usr/bin/env node
// Before/after screenshots of the preview-harness views a branch changes, for the PR's Screenshots section.
//
//   npm run shots                       views picked from the diff against the merge base with main
//   npm run shots -- --views chat,start  pick views yourself ("all" for every view)
//   npm run shots -- --no-before         after only
//   npm run shots -- --publish           push the PNGs to the `pr-shots` branch and print image links for the PR
//
// "Before" is the merge base, served from a temporary git worktree; "after" is this working tree.
// Both run Vite on a free port and are stopped at the end. PNGs go to .shots/pr/ (git-ignored).
import { spawn, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ALL_VIEWS, viewSlug, viewsFor } from "../src/lib/previewViews.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();

const hasRef = (ref) => {
  try { return Boolean(git("rev-parse", "--verify", "-q", ref)); } catch { return false; }
};
const baseRef = opt("base", hasRef("origin/main") ? "origin/main" : "main");
const base = git("merge-base", "HEAD", baseRef);
const outDir = resolve(root, opt("out", ".shots/pr"));
const width = Number(opt("width", 1440));
const height = Number(opt("height", 900));

function changedFiles() {
  const tracked = git("diff", "--name-only", base).split("\n");
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n");
  return [...tracked, ...untracked].filter(Boolean);
}

const asked = opt("views", "");
const views = asked === "all" ? ALL_VIEWS : asked ? asked.split(",").map((v) => v.trim()).filter(Boolean) : viewsFor(changedFiles());
if (!views.length) {
  console.log("No preview views affected by this diff. Pass --views to pick some.");
  process.exit(0);
}

function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

const children = [];
async function serve(dir) {
  const port = await freePort();
  const vite = join(root, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [vite, "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`vite exited in ${dir}:\n${log.slice(-2000)}`);
    try {
      if ((await fetch(`${url}/design/preview/`)).ok) return url;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`vite did not answer on ${url} within 30 s:\n${log.slice(-2000)}`);
}

let worktree = "";
function cleanup() {
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  if (worktree) {
    try { git("worktree", "remove", "--force", worktree); } catch {}
    worktree = "";
  }
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

async function capture(browser, url, label) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: "reduce", colorScheme: "dark" });
  const files = {};
  for (const view of views) {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${url}/design/preview/?theme=dark&view=${view}`, { waitUntil: "load" });
    // mock.ts sets __ready once the view's state is in place; a view the base doesn't know still renders the default.
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 20_000 }).catch(() => errors.push("__ready never set"));
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
    const file = join(outDir, `${viewSlug(view)}-${label}.png`);
    await page.screenshot({ path: file });
    files[view] = file;
    if (errors.length) console.warn(`${label} ${view}: ${errors.join("; ")}`);
    await page.close();
  }
  await ctx.close();
  return files;
}

function publish(files) {
  const remote = git("remote", "get-url", "origin");
  const slug = remote.replace(/\.git$/, "").match(/github\.com[/:]([^/]+\/[^/]+)$/)?.[1];
  if (!slug) throw new Error(`origin is not a GitHub repo: ${remote}`);
  const branch = git("branch", "--show-current") || "detached";
  const folder = `${branch.replace(/[^a-z0-9._-]+/gi, "-")}/${git("rev-parse", "--short", "HEAD")}`;
  const dir = mkdtempSync(join(tmpdir(), "pr-shots-"));
  const run = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  let hasRemote = true;
  try { git("fetch", "-q", "origin", "pr-shots"); } catch { hasRemote = false; }
  git("worktree", "add", "-q", "--detach", dir, hasRemote ? "FETCH_HEAD" : "HEAD");
  try {
    if (!hasRemote) {
      run("checkout", "-q", "--orphan", `pr-shots-${Date.now()}`);
      run("rm", "-rfq", ".");
    }
    mkdirSync(join(dir, folder), { recursive: true });
    for (const f of files) cpSync(f, join(dir, folder, f.split("/").pop()));
    run("add", folder);
    run("commit", "-q", "-m", `shots: ${folder}`);
    run("push", "-q", "origin", "HEAD:refs/heads/pr-shots");
    const sha = run("rev-parse", "HEAD");
    return (file) => `https://raw.githubusercontent.com/${slug}/${sha}/${folder}/${file.split("/").pop()}`;
  } finally {
    git("worktree", "remove", "--force", dir);
  }
}

mkdirSync(outDir, { recursive: true });
const { chromium } = await import("playwright");
const browser = await chromium.launch();
try {
  const after = await capture(browser, await serve(root), "after");
  let before = {};
  if (!flag("no-before")) {
    worktree = mkdtempSync(join(tmpdir(), "shots-base-"));
    rmSync(worktree, { recursive: true });
    git("worktree", "add", "-q", "--detach", worktree, base);
    if (!existsSync(join(worktree, "node_modules"))) symlinkSync(join(root, "node_modules"), join(worktree, "node_modules"));
    before = await capture(browser, await serve(worktree), "before");
  }
  const link = flag("publish") ? publish([...Object.values(before), ...Object.values(after)]) : (f) => f.replace(`${root}/`, "");
  const cell = (view, f) => (f ? `![${view}](${link(f)})` : "—");
  const lines = [flag("no-before") ? "| View | After |" : "| View | Before | After |", flag("no-before") ? "| --- | --- |" : "| --- | --- | --- |"];
  for (const v of views) lines.push(flag("no-before") ? `| \`${v}\` | ${cell(v, after[v])} |` : `| \`${v}\` | ${cell(v, before[v])} | ${cell(v, after[v])} |`);
  const md = lines.join("\n");
  writeFileSync(join(outDir, "shots.md"), md + "\n");
  console.log(md);
  console.log(`\nBase ${base.slice(0, 7)} (${baseRef}). PNGs in ${outDir.replace(`${root}/`, "")}/.`);
} finally {
  await browser.close();
  cleanup();
}
