/**
 * The council review (Theo Browne, 2026-11-04 stream): several reviewers read the same diff
 * independently, each scores it 1-10 and tags findings important / nit / pre-existing. A
 * finding counts as verified only when a second reviewer points at the same place, so you
 * read confirmed problems first instead of every guess one model made. No imports, so it
 * runs under `node --test`.
 */

/** `delete`: code nobody uses that can go (the nightly review asks for it; a PR review never does). */
export type Tag = "important" | "nit" | "pre-existing" | "delete";
export type Verdict = "ship" | "fix" | "block";

export interface Finding {
  tag: Tag;
  file?: string;
  line?: number;
  text: string;
  /** Reviewers that reported it. */
  by: string[];
}

export interface ReviewerReport {
  reviewer: string;
  score?: number;
  verdict?: Verdict;
  findings: Finding[];
  failed?: boolean;
}

export interface Council {
  /** Reviewers that finished. */
  reviewers: number;
  /** Mean of their scores, one decimal. */
  score?: number;
  /** The worst verdict any of them gave. */
  verdict?: Verdict;
  /** Verified first, then by tag (important, nit, pre-existing). */
  findings: (Finding & { verified: boolean })[];
}

const FINDING = /^\s*[-*]\s*\[(important|nit|pre-existing|delete)\]\s*(?:`?([\w./@-]+\.[\w]+)(?::(\d+))?`?\s*[-—–:]+\s*)?(.+)$/i;

export function parseReport(text: string, reviewer: string): ReviewerReport {
  const findings: Finding[] = [];
  let score: number | undefined;
  let verdict: Verdict | undefined;
  for (const raw of text.split("\n")) {
    const m = FINDING.exec(raw);
    if (m) {
      findings.push({
        tag: m[1].toLowerCase() as Tag,
        ...(m[2] && { file: m[2] }),
        ...(m[3] && { line: Number(m[3]) }),
        text: m[4].trim(),
        by: [reviewer],
      });
      continue;
    }
    const s = /score\s*:?\s*(\d+(?:\.\d+)?)\s*\/\s*10\b/i.exec(raw);
    if (s && Number(s[1]) <= 10) score = Number(s[1]);
    const v = /VERDICT:\s*\**\s*(ship|fix|block)\b/i.exec(raw);
    if (v) verdict = v[1].toLowerCase() as Verdict;
  }
  return { reviewer, ...(score !== undefined && { score }), ...(verdict && { verdict }), findings };
}

const SAME_PLACE_LINES = 3;
const TAG_ORDER: Tag[] = ["important", "delete", "nit", "pre-existing"];
const VERDICT_ORDER: Verdict[] = ["ship", "fix", "block"];

const samePlace = (a: Finding, b: Finding) =>
  !!a.file && a.file === b.file && a.line !== undefined && b.line !== undefined && Math.abs(a.line - b.line) <= SAME_PLACE_LINES;

export function mergeCouncil(reports: ReviewerReport[]): Council {
  const done = reports.filter((r) => !r.failed);
  const merged: Finding[] = [];
  for (const r of done) {
    for (const f of r.findings) {
      const hit = merged.find((m) => !m.by.includes(r.reviewer) && samePlace(m, f));
      if (!hit) merged.push({ ...f, by: [...f.by] });
      else {
        hit.by.push(r.reviewer);
        if (f.tag === "important") hit.tag = "important";
      }
    }
  }
  const scores = done.map((r) => r.score).filter((s): s is number => s !== undefined);
  const verdicts = done.map((r) => r.verdict).filter((v): v is Verdict => !!v);
  const findings = merged
    .map((f) => ({ ...f, verified: f.by.length >= 2 }))
    .sort((a, b) => Number(b.verified) - Number(a.verified) || TAG_ORDER.indexOf(a.tag) - TAG_ORDER.indexOf(b.tag));
  return {
    reviewers: done.length,
    ...(scores.length && { score: Math.round((scores.reduce((n, s) => n + s, 0) / scores.length) * 10) / 10 }),
    ...(verdicts.length && { verdict: verdicts.reduce((w, v) => (VERDICT_ORDER.indexOf(v) > VERDICT_ORDER.indexOf(w) ? v : w)) }),
    findings,
  };
}

/** Theo's tap-out: after `cap` rounds a review loop stops asking for more. 0 is no cap. */
export function roundCapped(rounds: number, cap: number): boolean {
  return cap > 0 && rounds >= cap;
}

/** The round a new review is: the count carries on for the same branch and starts over on another. */
export function nextRound(prev: { rounds: number; branch?: string } | undefined, branch: string | undefined): number {
  return prev && prev.branch === branch ? prev.rounds + 1 : 1;
}

/** A short, stable fingerprint of a diff's text (djb2), for caching per exact change. */
export function diffHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
}
