import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_VIEWS, CORE_VIEWS, viewSlug, viewsFor } from "./previewViews.ts";

test("a component maps to its own view", () => {
  assert.deepEqual(viewsFor(["src/components/ChatPane.tsx"]), ["chat"]);
  assert.deepEqual(viewsFor(["src/components/settings/AccountsSection.tsx"]), ["settings&section=accounts"]);
  assert.deepEqual(viewsFor(["src/components/settings/SoundsSection.tsx"]), ["settings"]);
  assert.deepEqual(viewsFor(["src/components/ChangesPanel.tsx"]), ["threads&rail=changes"]);
});

test("shared pieces map to every view that shows them", () => {
  assert.deepEqual(viewsFor(["src/components/AgentLogos.tsx"]), ["threads", "chat", "start"]);
  assert.deepEqual(viewsFor(["src/components/SkillsPanel.tsx"]), ["start"]);
});

test("shared styles and the shell map to the core views", () => {
  assert.deepEqual(viewsFor(["src/styles/tokens.css"]), CORE_VIEWS);
  assert.deepEqual(viewsFor(["src/App.tsx"]), CORE_VIEWS);
});

test("a view-specific stylesheet maps only to its view", () => {
  assert.deepEqual(viewsFor(["src/styles/board.css"]), ["board"]);
  assert.deepEqual(viewsFor(["src/styles/agentview.css"]), ["agentview"]);
});

test("back-end, tests and unknown files add no views", () => {
  assert.deepEqual(viewsFor(["src-tauri/src/chat.rs", "src/lib/chat.test.ts", "README.md", "src/lib/ipc.ts"]), []);
});

test("results are deduped and in harness order", () => {
  const got = viewsFor(["src/components/StartScreen.tsx", "src/components/ChatPane.tsx", "./src/components/Composer.tsx", "src\\components\\ThreadPanel.tsx"]);
  assert.deepEqual(got, ["threads", "threads&single=1", "chat", "start"]);
  for (const v of got) assert.ok(ALL_VIEWS.includes(v));
});

test("slugs are file-name safe", () => {
  assert.equal(viewSlug("settings&section=accounts"), "settings-section-accounts");
  assert.equal(viewSlug("chat"), "chat");
});

test("provider files map to the providers settings and the chat composer", () => {
  assert.deepEqual(viewsFor(["src/lib/providers.ts"]), ["chat", "settings&section=providers"]);
});

test("the goal banner and dialog have their own chat views", () => {
  assert.deepEqual(viewsFor(["src/components/GoalBar.tsx"]), ["chat&goal=1", "chat&goal=dialog"]);
  assert.deepEqual(viewsFor(["src/store/goals.ts", "src/lib/goalLoop.ts"]), ["chat&goal=1", "chat&goal=dialog"]);
});
