import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MODELS, escalate, harnessOfVariant, modelTier, routeModel, taskKind } from "./router.ts";

const CLAUDE = DEFAULT_MODELS.claude;

test("task kind comes from the wording, review first", () => {
  assert.equal(taskKind("Review this diff for security holes"), "review");
  assert.equal(taskKind("Research how Codex resumes a thread"), "research");
  assert.equal(taskKind("Run the failing playwright spec"), "test");
  assert.equal(taskKind("Make the settings page keyboard accessible"), "ui");
  assert.equal(taskKind("Rename the helper and lint the file"), "mechanical");
  assert.equal(taskKind("Build and package the app for release"), "build");
  assert.equal(taskKind("Add idempotency keys"), "general");
});

test("model tiers read from the name, cheap names first", () => {
  assert.equal(modelTier("claude-haiku-4-5"), 2);
  assert.equal(modelTier("claude-sonnet-4-5"), 4);
  assert.equal(modelTier("claude-opus-4-1"), 5);
  assert.equal(modelTier("gpt-5-codex-mini"), 2);
  assert.equal(modelTier("gpt-5-codex"), 4);
  assert.equal(modelTier("deepseek-v4.1-flash"), 2);
  assert.equal(modelTier("unknown-model"), 3);
});

test("balanced routing follows the task", () => {
  assert.equal(routeModel({ task: "review the auth diff", harness: "claude", available: CLAUDE, routing: "balanced" }).model, "claude-opus-4-1");
  assert.equal(routeModel({ task: "rename the helper", harness: "claude", available: CLAUDE, routing: "balanced" }).model, "claude-haiku-4-5");
  assert.equal(routeModel({ task: "fix the keyboard focus in settings", harness: "claude", available: CLAUDE, routing: "balanced" }).model, "claude-sonnet-4-5");
});

test("cheap and best override the task kind", () => {
  assert.equal(routeModel({ task: "review the auth diff", harness: "claude", available: CLAUDE, routing: "cheap" }).model, "claude-haiku-4-5");
  assert.equal(routeModel({ task: "rename the helper", harness: "claude", available: CLAUDE, routing: "best" }).model, "claude-opus-4-1");
});

test("failed models are not picked again", () => {
  const r = routeModel({ task: "review the auth diff", harness: "claude", available: CLAUDE, failed: ["claude-opus-4-1"] });
  assert.equal(r.model, "claude-sonnet-4-5");
  assert.match(r.why, /1 failed/);
});

test("every candidate failed still returns one, and says so", () => {
  const r = routeModel({ task: "review the auth diff", harness: "claude", available: CLAUDE, failed: CLAUDE });
  assert.equal(r.model, "claude-opus-4-1");
  assert.match(r.why, /every candidate failed/);
});

test("the harness's own models come first inside a tier", () => {
  const available = ["gemini-2.5-pro", "gpt-5-codex"];
  assert.equal(routeModel({ task: "review the diff", harness: "codex", available }).model, "gpt-5-codex");
  assert.equal(routeModel({ task: "review the diff", harness: "claude", available }).model, "gemini-2.5-pro");
});

test("no catalogue is no pick, not a guess", () => {
  const r = routeModel({ task: "review", available: [] });
  assert.equal(r.model, "");
  assert.match(r.why, /no model/);
});

test("manual keeps the pick, or falls back to the harness default", () => {
  assert.equal(routeModel({ task: "review", harness: "claude", available: CLAUDE, routing: "manual", preferred: "claude-sonnet-4-5" }).model, "claude-sonnet-4-5");
  assert.equal(routeModel({ task: "review", harness: "claude", available: CLAUDE, routing: "manual" }).model, "claude-haiku-4-5");
});

test("escalation is one tier up, and stops at the top", () => {
  assert.equal(escalate("claude-haiku-4-5", CLAUDE), "claude-sonnet-4-5");
  assert.equal(escalate("claude-sonnet-4-5", CLAUDE), "claude-opus-4-1");
  assert.equal(escalate("claude-opus-4-1", CLAUDE), undefined);
  assert.equal(escalate("claude-haiku-4-5", ["claude-haiku-4-5"]), undefined);
});

test("the same inputs give the same route", () => {
  const input = { task: "fix the flaky focus test", harness: "claude", available: CLAUDE, routing: "balanced" as const };
  assert.deepEqual(routeModel(input), routeModel(input));
});

test("launcher variants map to the runtime they actually start", () => {
  assert.equal(harnessOfVariant("claude:work"), "claude");
  assert.equal(harnessOfVariant("deepseek:claude"), "claude");
  assert.equal(harnessOfVariant("codex:oss"), "codex");
  assert.equal(harnessOfVariant("gemini:login"), "gemini");
  assert.equal(harnessOfVariant("deepseek:opencode"), "opencode");
  assert.equal(harnessOfVariant("grok:key"), "grok");
  assert.equal(harnessOfVariant("custom"), "custom");
});
