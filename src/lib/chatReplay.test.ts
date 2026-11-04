import assert from "node:assert/strict";
import { test } from "node:test";
import { addUser, emptyTranscript } from "./chatModel.ts";
import { takeReplay } from "./chatReplay.ts";

// Claude Code 2.x, --replay-user-messages: a message sent mid-turn is echoed when the CLI takes it,
// usually inside the running turn (seen 2026-11-02: one result answered both messages).
const echo = (uuid: string, content = "x") => ({ type: "user", isReplay: true, uuid, message: { role: "user", content } });

test("a queued message the CLI took mid-turn leaves the queue and joins the conversation", () => {
  const queued = [
    { text: "two", uuid: "u2" },
    { text: "three", uuid: "u3" },
  ];
  const r = takeReplay(emptyTranscript(), queued, echo("u2", "two"));
  assert.ok(r);
  assert.deepEqual(r.queued.map((q) => q.uuid), ["u3"]);
  assert.deepEqual(r.transcript.items.map((i) => [i.kind, (i as { text?: string }).text]), [["user", "two"]]);
});

test("the echo of a message already shown is ignored, not shown twice", () => {
  const t = addUser(emptyTranscript(), "one", 1, { uuid: "u1" });
  const r = takeReplay(t, [], echo("u1", "one"));
  assert.ok(r);
  assert.equal(r.transcript, t);
});

test("anything else is left to the normal line handling", () => {
  assert.equal(takeReplay(emptyTranscript(), [], echo("unknown")), null);
  assert.equal(takeReplay(emptyTranscript(), [{ text: "a", uuid: "u1" }], { type: "user", uuid: "u1", message: { content: "a" } }), null);
  assert.equal(takeReplay(emptyTranscript(), [], { type: "assistant" }), null);
});
