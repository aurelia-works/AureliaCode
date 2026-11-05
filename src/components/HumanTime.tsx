import { useEffect, useState } from "react";
import { humanStats, type HumanStats } from "../lib/humanStats";
import { ipc } from "../lib/ipc";

const per = (n: number, prs: number) => (prs ? (n / prs).toFixed(1) : "0");
const pct = (x: number) => `${Math.round(x * 100)}%`;

function span(ms: number | null): string {
  if (ms === null) return "none yet";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = m / 60;
  return h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)}h` : `${Math.round(h / 24)}d`;
}

/** A project's human time per merged PR, from `gh` (lib/humanStats.ts). People and bots are counted apart. */
export function HumanTime({ cwd }: { cwd: string }) {
  const [state, setState] = useState<{ stats?: HumanStats; error?: string } | null>(null);
  useEffect(() => {
    let live = true;
    setState(null);
    ipc
      .prHistory(cwd, 50)
      .then((prs) => live && setState({ stats: humanStats(prs) }))
      .catch((e) => live && setState({ error: String(e) }));
    return () => {
      live = false;
    };
  }, [cwd]);

  if (!state) return <p className="ht hint">Counting human time on recent PRs…</p>;
  const s = state.stats;
  if (!s) return <p className="ht hint">Human time needs GitHub: {state.error}</p>;
  if (!s.prs) return <p className="ht hint">No merged PRs yet, so no human time to count.</p>;
  return (
    <section className="ht" aria-label="Human time per PR">
      <h2>Human time · last {s.prs} merged PRs</h2>
      <dl>
        <div>
          <dt>Approvals per PR</dt>
          <dd className="num">
            {per(s.humanApprovals, s.prs)} people · {per(s.botApprovals, s.prs)} bots
          </dd>
        </div>
        <div>
          <dt>Comments per PR</dt>
          <dd className="num">
            {per(s.humanComments, s.prs)} people · {per(s.botComments, s.prs)} bots
          </dd>
        </div>
        <div>
          <dt>Waited on a person</dt>
          <dd className="num" title="Median time from opening to a person's first review or comment">
            {span(s.waitMedianMs)} median · {s.noHumanReview} with no person
          </dd>
        </div>
        <div>
          <dt>Reverted</dt>
          <dd className="num" title={s.reverted.length ? s.reverted.map((n) => `#${n}`).join(", ") : undefined}>
            {s.reverted.length} ({pct(s.revertRate)})
          </dd>
        </div>
        <div>
          <dt>Incidents</dt>
          <dd className="num" title="PRs labelled incident, hotfix or sevN">
            {s.incidents} ({pct(s.incidentRate)})
          </dd>
        </div>
      </dl>
    </section>
  );
}
