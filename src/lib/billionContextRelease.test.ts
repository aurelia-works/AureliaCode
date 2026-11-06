import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Installs the npm `latest` billion-context release and runs that `bili`.
// The fake Claude never calls a provider. A loopback stub is the only upstream.

const SECRET_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
];

function cleanEnv(extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" };
  for (const key of SECRET_KEYS) delete env[key];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function registryVersion(): string {
  const out = spawnSync("corepack", ["pnpm@11.21.0", "view", "billion-context", "version"], {
    encoding: "utf8",
    env: cleanEnv({}),
  });
  assert.equal(out.status, 0, out.stderr);
  const line = out.stdout.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "";
  assert.match(line, /^\d+\.\d+\.\d+[0-9A-Za-z.+-]*$/);
  return line;
}

function installedBili(version: string): string {
  const root = path.join(tmpdir(), `aurelia-bili-release-${version}`);
  const bili = path.join(root, "node_modules", ".bin", "bili");
  const pkgPath = path.join(root, "node_modules", "billion-context", "package.json");
  if (existsSync(pkgPath) && existsSync(bili)) {
    const found = JSON.parse(readFileSync(pkgPath, "utf8")).version;
    if (found === version) return bili;
  }
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ private: true, packageManager: "pnpm@11.21.0", dependencies: { "billion-context": version } }, null, 2)}\n`,
  );
  writeFileSync(path.join(root, ".npmrc"), "ignore-scripts=true\n");
  const out = spawnSync("corepack", ["pnpm@11.21.0", "install", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
    env: cleanEnv({}),
  });
  assert.equal(out.status, 0, (out.stderr || out.stdout).slice(-500));
  assert.equal(JSON.parse(readFileSync(pkgPath, "utf8")).version, version);
  return bili;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child: ChildProcess = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`timed out after ${timeoutMs}ms\n${stderr.slice(-600)}`));
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test("the installed release honors --bin before claude and keys sessions by the Claude header", { timeout: 120_000 }, async () => {
  const version = registryVersion();
  const bili = installedBili(version);
  const shown = spawnSync(bili, ["--version"], { encoding: "utf8", env: cleanEnv({}) });
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, new RegExp(version.replace(/[.]/g, "\\.")));
  const help = spawnSync(bili, ["--help"], { encoding: "utf8", env: cleanEnv({}) });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /must precede the client name/);

  const home = mkdtempSync(path.join(tmpdir(), "aurelia-bili-proof-"));
  const binDir = path.join(home, "bin");
  const configDir = path.join(home, "claude-config");
  const data = path.join(home, "data");
  const state = path.join(home, "state");
  const cache = path.join(home, "cache", "billion-context");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(data, { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(cache, { recursive: true });
  // A fresh cost row keeps the model catalog on disk, so the proxy does not fetch models.dev.
  writeFileSync(
    path.join(cache, "models-dev.json"),
    `${JSON.stringify({ models: { "local-stub": { id: "local-stub" } }, costs: { "local/stub": { input: 1 } } })}\n`,
  );
  const hits: { url: string; host: string; sid: string | null; agent: string | null; auth: boolean }[] = [];
  const stub = http.createServer((req, res) => {
    req.resume();
    hits.push({
      url: req.url ?? "",
      host: req.headers.host ?? "",
      sid: typeof req.headers["x-claude-code-session-id"] === "string" ? req.headers["x-claude-code-session-id"] : null,
      agent: typeof req.headers["x-claude-code-agent-id"] === "string" ? req.headers["x-claude-code-agent-id"] : null,
      auth: req.headers.authorization !== undefined,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_local",
      type: "message",
      role: "assistant",
      model: "local-stub",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
  });
  const stubPort = await new Promise<number>((resolve) => {
    stub.listen(0, "127.0.0.1", () => {
      const address = stub.address();
      if (address && typeof address === "object") resolve(address.port);
    });
  });

  const report = path.join(home, "report.json");
  const fake = path.join(home, "fake-claude");
  writeFileSync(
    fake,
    `#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const base = process.env.ANTHROPIC_BASE_URL || "";
fs.writeFileSync(process.env.PROOF_REPORT, JSON.stringify({ argv: process.argv.slice(2), base, https: process.env.HTTPS_PROXY || null, ca: process.env.NODE_EXTRA_CA_CERTS || null, ssl: process.env.SSL_CERT_FILE || null, configDir: process.env.CLAUDE_CONFIG_DIR || null }));
const port = new URL(base).port;
const stubPort = ${stubPort};
function post(sid, extra, system) {
  const body = JSON.stringify({ model: "local-stub", max_tokens: 8, system, messages: [{ role: "user", content: "ping " + sid }] });
  const headers = { "content-type": "application/json", "content-length": Buffer.byteLength(body), "x-claude-code-session-id": sid, ...extra };
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/bili/http://127.0.0.1:" + stubPort + "/v1/messages", headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", (err) => resolve(String(err)));
    req.end(body);
  });
}
(async () => {
  const codes = [];
  codes.push(await post("sess-a", {}, "You are a test."));
  codes.push(await post("sess-a", {}, "You are a test."));
  codes.push(await post("sess-b", {}, "You are a test."));
  codes.push(await post("sess-a", { "x-claude-code-agent-id": "agent-9" }, "You are a subagent worker, not the main assistant."));
  codes.push(await post("sess-a", { "x-claude-code-agent-id": "agent-main" }, "You are Claude Code, an interactive agent."));
  fs.writeFileSync(process.env.PROOF_CODES, JSON.stringify(codes));
  process.exit(0);
})();
`,
  );
  chmodSync(fake, 0o755);
  const decoyRan = path.join(home, "decoy.txt");
  writeFileSync(path.join(binDir, "claude"), `#!/bin/sh\nprintf '%s\\n' "$*" > ${JSON.stringify(decoyRan)}\nexit 0\n`);
  chmodSync(path.join(binDir, "claude"), 0o755);

  const logFile = path.join(home, "bili.log");
  const configFile = path.join(home, "billion-context.json");
  writeFileSync(configFile, `${JSON.stringify({ autoUpdate: false, advisoryCheck: false, releaseNotesCheck: false, mitm: { enabled: false } })}\n`);
  const launchEnv = cleanEnv({
    HOME: path.join(home, "userhome"),
    XDG_CONFIG_HOME: path.join(home, "xdg-config"),
    XDG_STATE_HOME: state,
    XDG_DATA_HOME: data,
    XDG_CACHE_HOME: path.join(home, "cache"),
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    ACP_AUTO_UPDATE: "0",
    BILI_ADVISORY_CHECK: "0",
    BILI_RELEASE_NOTES_CHECK: "0",
    BILI_MITM: "0",
    BILI_LAUNCHER_PLUGIN: "0",
    BILI_CONFIG_FILE: configFile,
    BILI_SESSIONS_DIR: path.join(home, "sessions"),
    ACP_LOG_FILE: logFile,
    CLAUDE_CONFIG_DIR: configDir,
    AURELIA_ACCOUNT: "work",
    PROOF_REPORT: report,
    PROOF_CODES: path.join(home, "codes.json"),
  });
  mkdirSync(launchEnv.HOME as string, { recursive: true });
  mkdirSync(launchEnv.XDG_CONFIG_HOME as string, { recursive: true });

  try {
    const launched = await run(
      bili,
      ["--host", "127.0.0.1", "--no-auto-update", "--bin", fake, "claude", "--", "--from-test"],
      launchEnv,
      20_000,
    );
    assert.equal(launched.code, 0, launched.stderr);
    assert.match(launched.stderr, /http:\/\/127\.0\.0\.1:\d+/);
    assert.match(launched.stderr, /HTTP \/bili\/ rewrites: 1/);
    assert.equal(launched.stderr.includes("HTTPS cert rewrites"), false);
    assert.equal(existsSync(decoyRan), false);

    const seen = JSON.parse(readFileSync(report, "utf8")) as { argv: string[]; base: string; https: string | null; ca: string | null; ssl: string | null; configDir: string };
    assert.deepEqual(seen.argv, ["--from-test"]);
    assert.match(seen.base, /^http:\/\/127\.0\.0\.1:\d+\/bili\/https:\/\/api\.anthropic\.com$/);
    assert.equal(seen.https, null);
    assert.equal(seen.ca, null);
    assert.equal(seen.ssl, null);
    assert.equal(seen.configDir, configDir);
    assert.deepEqual(readdirSync(configDir), []);
    assert.deepEqual(readdirSync(data), []);
    const codes = JSON.parse(readFileSync(path.join(home, "codes.json"), "utf8")) as number[];
    assert.deepEqual(codes, [200, 200, 200, 200, 200]);
    assert.equal(hits.length, 5);
    assert.deepEqual(hits.map((hit) => hit.sid), ["sess-a", "sess-a", "sess-b", "sess-a", "sess-a"]);
    assert.deepEqual(hits.map((hit) => hit.agent), [null, null, null, "agent-9", "agent-main"]);
    for (const hit of hits) {
      assert.equal(hit.url, "/v1/messages");
      assert.match(hit.host, /^127\.0\.0\.1:\d+$/);
      assert.equal(hit.auth, false);
    }

    const affinityPath = await new Promise<string>((resolve, reject) => {
      const started = Date.now();
      const look = () => {
        const found = walk(home).find((file) => file.endsWith(`${path.sep}prefix-affinity.json`));
        if (found) resolve(found);
        else if (Date.now() - started > 3000) reject(new Error(`no prefix-affinity.json under ${home}\n${walk(home).join("\n")}`));
        else setTimeout(look, 100);
      };
      look();
    });
    assert.equal(affinityPath, path.join(state, "billion-context", "prefix-affinity.json"));
    const affinity = JSON.parse(readFileSync(affinityPath, "utf8")) as { entries: { sessionId: string }[] };
    const ids = affinity.entries.map((entry) => entry.sessionId).sort();
    assert.deepEqual(ids, ["sess-a", "sess-a|sub:agent-9", "sess-b"]);
    assert.equal(ids.some((id) => id.includes("work")), false);
    const log = readFileSync(logFile, "utf8");
    assert.match(log, /\[sess=sess-a\]/);
    assert.match(log, /\[sess=sess-b\]/);
    assert.match(log, /sess-a\|sub:agent-9/);
    assert.equal(log.includes("api.anthropic.com"), false);
    assert.equal(log.includes("loaded models.dev"), false);

    const misplaced = path.join(home, "override-ran");
    const wrong = await run(bili, ["claude", "--bin", fake, "--", "--from-test"], { ...launchEnv, PROOF_REPORT: misplaced }, 20_000);
    assert.equal(wrong.code, 0, wrong.stderr);
    assert.equal(existsSync(misplaced), false);
    assert.match(readFileSync(decoyRan, "utf8"), new RegExp(`^--bin ${fake.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} -- --from-test`));
  } finally {
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
    for (const match of log.matchAll(/acp-proxy v\S+ \(pid (\d+)/g)) {
      try {
        process.kill(Number(match[1]), "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    spawnSync("pkill", ["-f", home]);
    for (let attempt = 0; attempt < 20 && existsSync(home); attempt++) {
      try {
        rmSync(home, { recursive: true, force: true });
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  }
});
