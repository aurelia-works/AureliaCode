import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { COMPRESSION_SUMMARY, afterObserve, compressionCopy, compressionForUpdate, compressionStamp, type CompressionFacts } from "./contextCompression.ts";

const ready: CompressionFacts = { phase: "ready", version: "0.0.0-test", reason: null, claude: true, active: [], failures: [] };

test("a new thread is stamped only for an enabled account", () => {
  assert.equal(compressionStamp(undefined, ["work"]), undefined);
  assert.equal(compressionStamp("work", undefined), undefined);
  assert.equal(compressionStamp("work", []), undefined);
  assert.equal(compressionStamp("home", ["work"]), undefined);
  assert.equal(compressionStamp("work", ["work"]), true);
});

test("choosing an account on a fresh start screen stamps that launch, and a running thread keeps its stamp", () => {
  const enabled = ["work"];
  assert.equal(compressionForUpdate({}, { account: "work" }, enabled), true);
  assert.equal(compressionForUpdate({}, { account: "home" }, enabled), undefined);
  assert.equal(compressionForUpdate({ chatUsed: true }, { account: "work" }, enabled), undefined);
  assert.equal(compressionForUpdate({ claudeSession: "s1", contextCompression: true }, { account: "home" }, []), true);
  assert.equal(compressionForUpdate({ contextCompression: true }, {}, enabled), true);
  assert.equal(compressionForUpdate({}, { account: "work", provider: "opencode" }, enabled), undefined);
});

test("the product sentence does not claim a measured cache rate or an infinite window", () => {
  assert.match(COMPRESSION_SUMMARY, /existing Claude provider/);
  assert.match(COMPRESSION_SUMMARY, /on this Mac/);
  assert.match(COMPRESSION_SUMMARY, /not a local model/);
  assert.match(COMPRESSION_SUMMARY, /not exact/);
  assert.match(COMPRESSION_SUMMARY, /finite/);
  assert.equal(COMPRESSION_SUMMARY.includes("95"), false);
  assert.equal(COMPRESSION_SUMMARY.toLowerCase().includes("infinite"), false);
});

test("status names each install and proxy state", () => {
  const absent = compressionCopy({ ...ready, phase: "absent", version: null }, [], ["work"]);
  assert.match(absent.status, /Not installed/);
  assert.equal(absent.perAccount.work, "Off");
  assert.equal(compressionCopy({ ...ready, phase: "absent", version: null }, ["work"], ["work"]).perAccount.work, "On · install first");
  assert.equal(compressionCopy({ ...ready, phase: "unavailable", reason: "Claude Code isn't on PATH." }, ["work"], ["work"]).perAccount.work, "On · unavailable");

  const unavailable = compressionCopy({ ...ready, phase: "unavailable", reason: "Claude Code isn't on PATH." }, ["work"], ["work"]);
  assert.match(unavailable.status, /Installed, but unavailable/);
  assert.match(unavailable.status, /will not start/);
  assert.equal(unavailable.tone, "bad");

  const idle = compressionCopy(ready, ["work"], ["work", "home"]);
  assert.match(idle.status, /No active compression proxy/);
  assert.match(idle.status, /next new thread/);
  assert.equal(idle.perAccount.work, "On · no proxy");
  assert.equal(idle.perAccount.home, "Off");

  const active = compressionCopy({ ...ready, active: [{ paneId: "p1", account: "work" }] }, ["work"], ["work"]);
  assert.match(active.status, /Compressing 1 new thread for work/);
  assert.match(active.status, /existing Claude provider/);
  assert.equal(active.perAccount.work, "Compressing");

  const failed = compressionCopy({ ...ready, failures: [{ paneId: "p1", account: "work", code: 2 }] }, ["work"], ["work"]);
  assert.match(failed.status, /was not left on plain Claude/);
  assert.match(failed.status, /exit 2/);
  assert.equal(failed.perAccount.work, "Failed");

  const off = compressionCopy(ready, [], ["work"]);
  assert.match(off.status, /Off for every account/);
  assert.match(off.status, /No compression proxy is running/);
});

test("a status check does not ask for a restart", () => {
  assert.equal(afterObserve(), "none");
});

test("the wrapper runs bili once, stays on loopback, and records a failure without retrying", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aurelia-bili-wrap-"));
  const hitsPath = path.join(dir, "hits.json");
  // A separate process: spawnSync would freeze an in-process server and deadlock the client.
  const stub = spawn(process.execPath, ["-e", `
    const http = require("http");
    const fs = require("fs");
    const hits = [];
    const server = http.createServer((req, res) => {
      hits.push(String(req.socket.remoteAddress || "") + " " + req.url);
      res.end("ok");
    });
    server.listen(0, "127.0.0.1", () => process.stdout.write(String(server.address().port) + "\\n"));
    process.on("SIGTERM", () => {
      fs.writeFileSync(process.env.HITS, JSON.stringify(hits));
      server.close(() => process.exit(0));
    });
  `], { env: { ...process.env, HITS: hitsPath }, stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise<string>((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("toy server did not bind")), 5000);
    stub.stdout?.on("data", (chunk) => {
      buf += chunk.toString();
      const line = buf.split("\n")[0];
      if (line) {
        clearTimeout(timer);
        resolve(line.trim());
      }
    });
    stub.on("exit", (code) => reject(new Error(`toy server exited ${code}`)));
  });

  const bili = path.join(dir, "bili.js");
  const report = path.join(dir, "report.json");
  writeFileSync(
    bili,
    `#!/usr/bin/env node
const fs = require("fs");
const http = require("http");
const argv = process.argv.slice(2);
const bad = argv.some((a) => a === "0.0.0.0" || a === "--mitm-domain");
const env = {
  auto: process.env.ACP_AUTO_UPDATE ?? null,
  advisory: process.env.BILI_ADVISORY_CHECK ?? null,
  plugin: process.env.BILI_LAUNCHER_PLUGIN ?? null,
  configDir: process.env.CLAUDE_CONFIG_DIR ?? null,
  https: process.env.HTTPS_PROXY ?? null,
  ca: process.env.NODE_EXTRA_CA_CERTS ?? null,
  direct: process.env.BILI_LAUNCHER_DIRECT ?? null,
};
fs.writeFileSync(process.env.BILI_REPORT, JSON.stringify({ argv, bad, env }));
const req = http.get("http://127.0.0.1:${port}/upstream", (res) => { res.resume(); res.on("end", () => process.exit(bad ? 3 : 0)); });
req.on("error", () => process.exit(4));
`,
  );
  const wrap = path.join(dir, "wrap.sh");
  writeFileSync(wrap, readFileSync(new URL("../../src-tauri/resources/aurelia-bili-wrap.sh", import.meta.url)));
  const rec = path.join(dir, "rec");
  const claude = path.join(dir, "claude-bin");
  writeFileSync(claude, "#!/bin/sh\nexit 0\n");
  const args = ["--host", "127.0.0.1", "--no-auto-update", "--bin", claude, "claude", "--", "--settings", "/tmp/aurelia-settings.json", "-p"];
  const env = { ...process.env } as Record<string, string | undefined>;
  for (const key of ["HTTPS_PROXY", "https_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "BILI_LAUNCHER_DIRECT"]) delete env[key];
  const run = spawnSync("sh", [wrap, process.execPath, bili, ...args], {
    env: {
      ...env,
      AURELIA_COMPRESSION_RECORD: rec,
      AURELIA_ACCOUNT: "work",
      ACP_AUTO_UPDATE: "0",
      BILI_ADVISORY_CHECK: "0",
      BILI_LAUNCHER_PLUGIN: "0",
      CLAUDE_CONFIG_DIR: "/tmp/claude-work",
      BILI_REPORT: report,
    },
  });
  if (stub.exitCode === null) {
    const exited = new Promise((resolve) => stub.once("exit", resolve));
    stub.kill("SIGTERM");
    await exited;
  }
  const hits = JSON.parse(readFileSync(hitsPath, "utf8")) as string[];
  const body = JSON.parse(readFileSync(report, "utf8")) as { argv: string[]; bad: boolean; env: Record<string, string | null> };
  assert.equal(run.status, 0, run.stderr.toString());
  assert.equal(body.bad, false);
  assert.deepEqual(body.argv, args);
  assert.equal(body.env.auto, "0");
  assert.equal(body.env.advisory, "0");
  assert.equal(body.env.plugin, "0");
  assert.equal(body.env.configDir, "/tmp/claude-work");
  assert.equal(body.env.https, null);
  assert.equal(body.env.ca, null);
  assert.equal(body.env.direct, null);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /127\.0\.0\.1 /);
  assert.equal(readFileSync(path.join(dir, "rec.account"), "utf8").trim(), "work");
  // Success removes the pid and any earlier failure. Nothing is left running.
  assert.throws(() => readFileSync(`${rec}.pid`));
  assert.throws(() => readFileSync(`${rec}.exit`));

  const fail = spawnSync("sh", [wrap, process.execPath, "-e", "process.exit(2)"], {
    env: { ...process.env, AURELIA_COMPRESSION_RECORD: rec, AURELIA_ACCOUNT: "work" },
  });
  assert.equal(fail.status, 2);
  assert.equal(readFileSync(`${rec}.exit`, "utf8").trim(), "2");
  assert.throws(() => readFileSync(`${rec}.pid`));
  const again = readFileSync(`${rec}.exit`, "utf8");
  assert.equal(again.trim(), "2", "a failed record stays until another launch; nothing restarts it");

  // A backgrounded command would have /dev/null as stdin and drop the chat protocol.
  const echoed = spawnSync(
    "sh",
    [wrap, process.execPath, "-e", 'let s=""; process.stdin.on("data", (d) => { s += d; }); process.stdin.on("end", () => { process.stdout.write(s); process.exit(0); });'],
    { input: '{"type":"user"}\n', encoding: "utf8", env: { ...process.env, AURELIA_COMPRESSION_RECORD: rec, AURELIA_ACCOUNT: "work" } },
  );
  assert.equal(echoed.status, 0, echoed.stderr);
  assert.equal(echoed.stdout, '{"type":"user"}\n');
  rmSync(dir, { recursive: true, force: true });
});

test("closing the wrapper stops a detached proxy and is not recorded as a failure", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aurelia-bili-kill-"));
  const survivor = path.join(dir, "survivor");
  const bili = path.join(dir, "bili.js");
  writeFileSync(
    bili,
    `const { spawn } = require("child_process");
const fs = require("fs");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
fs.writeFileSync(process.env.SURVIVOR, String(child.pid));
child.unref();
setInterval(() => {}, 1000);
`,
  );
  const wrap = path.join(dir, "wrap.sh");
  writeFileSync(wrap, readFileSync(new URL("../../src-tauri/resources/aurelia-bili-wrap.sh", import.meta.url)));
  const rec = path.join(dir, "rec");
  // detached: the wrapper leads its own process group, which is how chat spawn closes a thread.
  const child = spawn("sh", [wrap, process.execPath, bili], {
    detached: true,
    env: { ...process.env, AURELIA_COMPRESSION_RECORD: rec, AURELIA_ACCOUNT: "work", SURVIVOR: survivor },
  });
  const pid = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("detached proxy pid was not recorded")), 4000);
    const look = setInterval(() => {
      try {
        const text = readFileSync(survivor, "utf8").trim();
        if (text) {
          clearTimeout(timer);
          clearInterval(look);
          resolve(text);
        }
      } catch {
        /* not written yet */
      }
    }, 20);
  });
  // The wrapper snapshots bili's children on a short interval. Wait until that file exists.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("wrapper did not snapshot the detached proxy")), 4000);
    const look = setInterval(() => {
      try {
        const kids = readFileSync(`${rec}.kids`, "utf8");
        if (kids.includes(pid)) {
          clearTimeout(timer);
          clearInterval(look);
          resolve();
        }
      } catch {
        /* not written yet */
      }
    }, 20);
  });
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  process.kill(-(child.pid ?? 0), "SIGTERM");
  const status = await Promise.race([
    exited,
    new Promise<number>((_, reject) => setTimeout(() => reject(new Error("wrapper did not exit after the thread was closed")), 4000)),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 200));
  let alive = true;
  try {
    process.kill(Number(pid), 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, false, "the detached proxy must not outlive the thread");
  assert.equal(status, 0, "closing the thread is not a compression failure");
  assert.throws(() => readFileSync(`${rec}.exit`));
  assert.throws(() => readFileSync(`${rec}.pid`));
  rmSync(dir, { recursive: true, force: true });
});
