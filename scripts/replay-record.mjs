// Saves a Claude Code session as a replay for the no-token e2e test (lib/replay.ts, scripts/e2e.mjs).
// Usage: node scripts/replay-record.mjs <session.jsonl> <name> [--turns n]
//   <session.jsonl>: a transcript from ~/.claude/projects/<folder>/, or saved `claude -p --output-format stream-json` output.
// Writes design/replays/<name>.jsonl with only chat lines and your home folder written as ~.
// It still holds the session's prompts and tool output: read it before committing.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { parseReplay, sanitizeLine } from "../src/lib/replay.ts";

const [src, name] = process.argv.slice(2);
if (!src || !name || !/^[\w-]+$/.test(name)) {
  console.error("usage: node scripts/replay-record.mjs <session.jsonl> <name> [--turns n]");
  process.exit(2);
}
const i = process.argv.indexOf("--turns");
const maxTurns = i > 0 ? Number(process.argv[i + 1]) : Infinity;
if (!(maxTurns >= 1)) {
  console.error("--turns needs a number of 1 or more");
  process.exit(2);
}

const lines = readFileSync(src, "utf8")
  .split("\n")
  .flatMap((s) => {
    try {
      return [JSON.parse(s)];
    } catch {
      return [];
    }
  })
  .map((l) => sanitizeLine(l, homedir()))
  .filter(Boolean);

// Keep the first `maxTurns` turns: cut at the prompt that would start the next one.
let prompts = 0;
const end = lines.findIndex((l) => parseReplay([l]).length === 1 && ++prompts > maxTurns);
const kept = end < 0 ? lines : lines.slice(0, end);
const out = `design/replays/${name}.jsonl`;
writeFileSync(out, kept.map((l) => JSON.stringify(l)).join("\n") + "\n");
console.log(`${out}: ${parseReplay(kept).length} turns, ${kept.length} lines. Read it before committing.`);
