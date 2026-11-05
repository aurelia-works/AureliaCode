// End-to-end chat test with no tokens: the preview harness replays design/replays/<name>.jsonl (lib/replay.ts)
// through the real chat store and view. Fails on any request that leaves this machine.
// Usage: npm run e2e [-- --replay fix-arrow-key] [--headed]
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const replay = arg("replay", "fix-arrow-key");

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
}).catch((e) => {
  vite.kill();
  throw e;
});

const failures = [];
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`FAIL ${name}: ${String(e.message ?? e).split("\n")[0]}`);
  }
};

let browser;
try {
  browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const outside = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && u.protocol !== "data:" && u.protocol !== "blob:") outside.push(r.url());
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`http://localhost:${port}/design/preview/?view=chat&replay=${replay}&replayMs=15`);
  const box = page.locator("textarea[data-chat-input]").last();
  const say = async (text) => {
    await box.fill(text);
    await page.locator("button.chat-send").last().click();
  };
  const body = page.locator("body");

  await step("the composer is ready", () => box.waitFor({ timeout: 20000 }));
  await step("first turn: tools run and the answer lands", async () => {
    await say("The right arrow types a box in the composer. Find why and fix it.");
    await body.getByText("Only printable keys insert now.").waitFor({ timeout: 10000 });
  });
  await step("first turn: the files card lists the edit", () => body.getByText("Composer.tsx").first().waitFor({ timeout: 5000 }));
  await step("second turn: a follow-up gets the next recorded turn", async () => {
    // The turn has ended once its "Worked for" line shows.
    await body.getByText(/Worked for/).first().waitFor({ timeout: 5000 });
    await say("Add a test for it.");
    await body.getByText("12 of 12 pass.").waitFor({ timeout: 10000 });
  });
  await step("both prompts stay in the conversation", async () => {
    for (const t of ["Find why and fix it.", "Add a test for it."]) await body.getByText(t).first().waitFor({ timeout: 2000 });
  });
  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors[0]);
  });
  await step("no request left this machine", async () => {
    if (outside.length) throw new Error(outside[0]);
  });
} finally {
  await browser?.close();
  vite.kill();
}
console.log(failures.length ? `e2e: ${failures.length} failed` : "e2e: all passed");
process.exit(failures.length ? 1 : 0);
