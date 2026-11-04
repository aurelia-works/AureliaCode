import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUrl } from "./url.ts";

test("the address bar uses the chosen search engine", () => {
  assert.equal(normalizeUrl("hello world", "duckduckgo"), "https://duckduckgo.com/?q=hello%20world");
  assert.equal(normalizeUrl("hello world", "google"), "https://www.google.com/search?q=hello%20world");
  assert.equal(normalizeUrl("hello world", "bing"), "https://www.bing.com/search?q=hello%20world");
});

test("bare hosts still become URLs, not searches", () => {
  assert.equal(normalizeUrl("localhost:5173", "google"), "http://localhost:5173");
  assert.equal(normalizeUrl("example.com/docs", "bing"), "https://example.com/docs");
  assert.equal(normalizeUrl("https://example.com?a=1", "google"), "https://example.com?a=1");
});
