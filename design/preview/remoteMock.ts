// The phone remote (AureliaBot) against a scripted Mac: a fake WebSocket that sends a snapshot
// and records actions. ?view=remote (agent list), remote&pane=chat (a conversation),
// remote&sheet=new (the new-agent sheet).
import type { Snapshot } from "../../src/remote/Remote";

const q = new URLSearchParams(location.search);

const snap: Snapshot = {
  panes: [
    {
      id: "p1",
      title: "claude",
      where: "api-server",
      account: "work",
      tab: 1,
      status: "needs_input",
      chat: {
        status: "waiting",
        model: "claude-opus-5-5",
        provider: "Claude · work",
        last: "The backfill touches 41k rows; I'll run it in batches of 1,000.",
        approvals: [{ id: "r1", tool: "Bash", what: "psql -f scripts/backfill_org_id.sql" }],
        queued: 0,
        costUsd: 1.84,
      },
    },
    {
      id: "p2",
      title: "claude",
      where: "web",
      account: "claude-b",
      tab: 2,
      status: "working",
      chat: {
        status: "working",
        model: "claude-sonnet-5-5",
        provider: "Claude · claude-b",
        last: "Arrow keys go straight to the textarea; nothing in the app listens for them.",
        approvals: [],
        queued: 1,
        goal: { text: "Settings nav passes the keyboard test suite", round: 2, max: 6, last: "3 of 11 failing" },
        costUsd: 3.12,
      },
      conv: [
        { id: "u1", kind: "user", text: "The composer gets 7 boxes when I press the right arrow. Find out whether it's us." },
        { id: "t1", kind: "tool", name: "Grep", text: "ArrowRight" },
        { id: "t2", kind: "tool", name: "Read", text: "src/lib/controlChars.ts" },
        { id: "x1", kind: "text", text: "Same story: paste takes clipboardData.getData(\"text/plain\") and strips control characters before it reaches the textarea." },
        { id: "u2", kind: "user", text: "Skip the paste path, look at the arrow keys instead." },
        { id: "x2", kind: "text", text: "Arrow keys go straight to the textarea; nothing in the app listens for them while the composer has focus." },
        { id: "t3", kind: "tool", name: "Bash", text: "npm test -- settings-nav", failed: true },
      ],
    },
    {
      id: "p3",
      title: "opencode",
      where: "docs",
      tab: 3,
      status: "done",
      chat: { status: "idle", model: "anthropic/claude-haiku-5-5", provider: "OpenCode", last: "Quickstart rewritten for the new CLI flags. 3 files changed.", approvals: [], queued: 0, costUsd: 0.71 },
    },
    { id: "p4", title: "zsh", where: "infra", tab: 4, status: "shell" },
  ],
  accounts: ["work", "claude-b"],
  projects: [
    { name: "api-server", path: "/Users/jah/dev/api-server" },
    { name: "web", path: "/Users/jah/dev/web" },
    { name: "docs", path: "/Users/jah/dev/docs" },
  ],
  providers: [
    { id: "claude:work", label: "Claude · work", models: ["default", "auto", "opus", "sonnet", "haiku"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
    { id: "claude:claude-b", label: "Claude · claude-b", models: [{ value: "default", label: "Default" }] },
    { id: "opencode", label: "OpenCode", models: [{ value: "default", label: "Default" }, { value: "anthropic/claude-sonnet-5-5", label: "claude-sonnet-5-5" }] },
    { id: "grok", label: "Grok", disabled: "Not signed in", models: [] },
  ],
  // ?refused=1: the Mac just turned an action down (the banner shows, then clears).
  refused: q.get("refused") ? { why: "unknown folder", at: Date.now() } : undefined,
};

/** Records what the page sends; `window.__sent` for checks. */
const sent: unknown[] = ((window as any).__sent = []);

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  binaryType = "arraybuffer";
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    (window as any).__socket = this;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
      this.onmessage?.({ data: JSON.stringify({ t: "snap", snap }) });
    }, 0);
  }
  send(d: string) {
    sent.push(JSON.parse(d));
  }
  /** Checks call this to act as if the link dropped: nothing more gets through. */
  drop() {
    this.readyState = 3;
  }
  close() {
    this.readyState = 3;
  }
}
(window as any).WebSocket = FakeSocket;

if (q.get("pane") === "chat") history.replaceState(null, "", `${location.pathname}${location.search}#p=p2`);

await import("../../src/remote/main.tsx");

const settle = () => new Promise((r) => setTimeout(r, 200));
await settle();
if (q.get("sheet") === "new") {
  (document.querySelector(".rm-fab") as HTMLButtonElement | null)?.click();
  await settle();
  const task = document.querySelector(".rm-task") as HTMLTextAreaElement | null;
  if (task) {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    set.call(task, "Add a keyboard test for the settings nav");
    task.dispatchEvent(new Event("input", { bubbles: true }));
  }
  await settle();
}
(window as any).__ready = true;
