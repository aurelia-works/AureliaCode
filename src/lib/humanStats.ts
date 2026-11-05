/**
 * Human time per PR (Theo, 2026-11-04 01:58: "we track human approvals per PR, human comments, and how long a PR
 * waits on a person"), with reverts and incidents as guardrails. Bot approvals are counted apart from people's.
 * Input is `gh pr list --state merged --json number,title,body,author,createdAt,mergedAt,labels,reviews,comments`.
 */

export interface GhUser {
  login: string;
  is_bot?: boolean;
}
export interface GhPr {
  number: number;
  title: string;
  body?: string;
  author?: GhUser | null;
  createdAt: string;
  mergedAt?: string | null;
  labels?: { name: string }[];
  reviews?: { author?: GhUser | null; state: string; submittedAt?: string | null }[];
  comments?: { author?: GhUser | null; body?: string; createdAt: string }[];
}

export interface HumanStats {
  prs: number;
  humanApprovals: number;
  botApprovals: number;
  humanComments: number;
  botComments: number;
  /** PRs no person reviewed or commented on. */
  noHumanReview: number;
  /** Median ms from open to a person's first review or comment; null when no PR had one. */
  waitMedianMs: number | null;
  /** PR numbers a later merged PR reverted. */
  reverted: number[];
  revertRate: number;
  incidents: number;
  incidentRate: number;
}

const BOT_LOGINS = new Set(["github-actions", "dependabot", "renovate", "copilot", "coderabbitai", "claude"]);

export function isBot(u: GhUser | null | undefined): boolean {
  if (!u?.login) return true;
  return !!u.is_bot || u.login.endsWith("[bot]") || BOT_LOGINS.has(u.login.toLowerCase());
}

/** A comment a tool posted under a person's account, like the verify-pr verdict or the CI size table. */
const fromTool = (body?: string) => !!body && body.trimStart().startsWith("<!--");

const REVERTS = [/^Revert\b[^#\n]*#(\d+)/i, /\bReverts [\w.-]+\/[\w.-]+#(\d+)/, /\bThis reverts [^#\n]*#(\d+)/i];
const INCIDENT = /incident|hotfix|sev\d/i;

function revertTarget(pr: GhPr): number | null {
  for (const re of REVERTS) {
    const m = re.exec(pr.title) ?? re.exec(pr.body ?? "");
    if (m) return Number(m[1]);
  }
  return null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function humanStats(prs: GhPr[]): HumanStats {
  let humanApprovals = 0, botApprovals = 0, humanComments = 0, botComments = 0, noHumanReview = 0;
  const waits: number[] = [];
  const reverted = new Set<number>();
  for (const pr of prs) {
    const t = revertTarget(pr);
    if (t !== null) reverted.add(t);
    const touches: number[] = [];
    for (const r of pr.reviews ?? []) {
      const bot = isBot(r.author);
      if (r.state === "APPROVED") bot ? botApprovals++ : humanApprovals++;
      if (!bot && r.author?.login !== pr.author?.login && r.submittedAt) touches.push(Date.parse(r.submittedAt));
    }
    for (const c of pr.comments ?? []) {
      const bot = isBot(c.author) || fromTool(c.body);
      bot ? botComments++ : humanComments++;
      if (!bot && c.author?.login !== pr.author?.login) touches.push(Date.parse(c.createdAt));
    }
    if (touches.length) waits.push(Math.min(...touches) - Date.parse(pr.createdAt));
    else noHumanReview++;
  }
  // Rates are over the PRs that aren't reverts themselves, so a revert of a revert doesn't count twice.
  const base = prs.filter((p) => revertTarget(p) === null);
  const hit = base.map((p) => p.number).filter((n) => reverted.has(n)).sort((a, b) => a - b);
  const incidents = base.filter((p) => (p.labels ?? []).some((l) => INCIDENT.test(l.name))).length;
  return {
    prs: prs.length,
    humanApprovals,
    botApprovals,
    humanComments,
    botComments,
    noHumanReview,
    waitMedianMs: median(waits),
    reverted: hit,
    revertRate: base.length ? hit.length / base.length : 0,
    incidents,
    incidentRate: base.length ? incidents / base.length : 0,
  };
}
