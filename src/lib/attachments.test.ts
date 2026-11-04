import { test } from "node:test";
import assert from "node:assert/strict";
import { capError, chipNote, forSend, formatSize, kindOf, looksLikeText, MAX_ATTACHMENTS, MAX_MESSAGE_BYTES, mediaTypeFor, sentBytes, settleRead, type Attachment } from "./attachments.ts";

test("files route to the block Claude Code takes for them", () => {
  assert.equal(kindOf("shot.png", "image/png"), "image");
  assert.equal(kindOf("photo.HEIC", "image/heic"), "image");
  assert.equal(kindOf("spec.pdf", "application/pdf"), "pdf");
  assert.equal(kindOf("spec.pdf"), "pdf");
  for (const n of ["notes.md", "data.json", "rows.csv", "main.rs", "App.tsx", "conf.yaml"]) assert.equal(kindOf(n), "text", n);
  assert.equal(kindOf("readme", "text/plain"), "text");
  assert.equal(kindOf("Makefile"), "text");
  for (const n of ["archive.zip", "deck.pptx", "song.mp3", "app.dmg"]) assert.equal(kindOf(n, "application/octet-stream"), "path", n);
});

test("media types are what the API expects", () => {
  assert.equal(mediaTypeFor("pdf", "a.pdf"), "application/pdf");
  assert.equal(mediaTypeFor("text", "a.csv", "text/csv"), "text/plain");
  assert.equal(mediaTypeFor("image", "a.JPG"), "image/jpeg");
  assert.equal(mediaTypeFor("image", "a.webp", "image/webp"), "image/webp");
});

const att = (over: Partial<Attachment>): Attachment => ({ id: "a", name: "a", size: 0, kind: "text", mediaType: "text/plain", status: "ready", ...over });

test("the cap counts what is sent, not what is on disk", () => {
  assert.equal(sentBytes(att({ kind: "pdf", data: "QUJD" })), 4);
  assert.equal(sentBytes(att({ kind: "text", data: "héllo" })), 6);
  assert.equal(sentBytes(att({ kind: "path", size: 10_000_000 })), 0);
  // Still reading: estimated from the file size (base64 grows by a third).
  assert.equal(sentBytes(att({ kind: "pdf", size: 3 })), 4);
});

test("a file that would push the message past 32 MB is refused with the reason", () => {
  const big = att({ kind: "pdf", data: "x".repeat(MAX_MESSAGE_BYTES - 10) });
  assert.equal(capError([big], 10), null);
  assert.match(capError([big], 11) ?? "", /32 MB/);
  // Failed chips don't count against the cap.
  assert.equal(capError([{ ...big, status: "error" }], 1000), null);
  const many = Array.from({ length: MAX_ATTACHMENTS }, () => att({}));
  assert.match(capError(many, 0) ?? "", /up to 20/);
});

test("sizes read like a person would say them", () => {
  assert.equal(formatSize(812), "812 B");
  assert.equal(formatSize(14 * 1024), "14 KB");
  assert.equal(formatSize(3.2 * 1024 * 1024), "3.2 MB");
  assert.equal(formatSize(32 * 1024 * 1024), "32 MB");
});

test("binary isn't taken for text", () => {
  assert.equal(looksLikeText(new TextEncoder().encode("name,score\nα,1\n")), true);
  assert.equal(looksLikeText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])), false);
  assert.equal(looksLikeText(new Uint8Array([0xff, 0xfe, 0xfd])), false);
});

test("only ready attachments are sent, each as its kind", () => {
  const list = [
    att({ id: "1", kind: "image", mediaType: "image/png", data: "iVBOR" }),
    att({ id: "2", kind: "pdf", name: "spec.pdf", data: "JVBER" }),
    att({ id: "3", kind: "text", name: "rows.csv", data: "a,b\n" }),
    att({ id: "4", kind: "path", name: "deck.pptx", path: "/Users/you/My Deck.pptx" }),
    att({ id: "5", kind: "path", name: "a.zip", path: "/tmp/a.zip" }),
    att({ id: "6", kind: "pdf", name: "broken.pdf", status: "error", data: "x" }),
    att({ id: "7", kind: "text", name: "slow.md", status: "reading" }),
  ];
  const out = forSend(list);
  assert.deepEqual(out.images, [{ mediaType: "image/png", data: "iVBOR" }]);
  assert.deepEqual(out.documents, [
    { kind: "pdf", name: "spec.pdf", data: "JVBER" },
    { kind: "text", name: "rows.csv", data: "a,b\n" },
  ]);
  assert.equal(out.refs, '@"/Users/you/My Deck.pptx" @/tmp/a.zip');
});

test("the chip says what will happen to the file", () => {
  assert.equal(chipNote(att({ kind: "path", size: 2048 })), "2 KB · sent as its path");
  assert.equal(chipNote(att({ kind: "pdf", size: 2048 })), "PDF · 2 KB");
  assert.equal(chipNote(att({ status: "reading" })), "Reading…");
  assert.equal(chipNote(att({ status: "error", error: "Not text" })), "Not text");
});

test("files dropped from Finder (size unknown until read) can't add up past the cap", () => {
  const draft = (id: string): Attachment => ({ id, name: `${id}.pdf`, size: 0, kind: "pdf", mediaType: "application/pdf", path: `/x/${id}.pdf`, status: "reading" });
  const read = { size: 15_000_000, data: "A".repeat(20_000_000), status: "ready" as const };
  let list = [draft("a"), draft("b"), draft("c")];
  list = settleRead(list, "a", read);
  list = settleRead(list, "b", read);
  assert.deepEqual(list.map((a) => a.status), ["ready", "error", "reading"]);
  assert.match(list[1].error ?? "", /32 MB/);
  assert.equal(list[1].data, undefined, "a refused file doesn't keep its bytes");
  list = settleRead(list, "c", { ...read, data: "A".repeat(1000) });
  assert.equal(list[2].status, "ready");
});
