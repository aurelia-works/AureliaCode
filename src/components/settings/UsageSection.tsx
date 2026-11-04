import { useEffect } from "react";
import type { Forecast } from "../../lib/forecast";
import { useConfig } from "../../store/config";
import { formatDuration, formatReset, useUsage } from "../../store/usage";
import { AgentLogo } from "../AgentLogos";
import type { SectionProps } from "./registry";

const leftOf = (used: number | null) => (used === null ? null : Math.max(0, Math.round(100 - used)));

function Window({ label, used, reset, forecast }: { label: string; used: number | null; reset: string | null; forecast?: Forecast }) {
  const left = leftOf(used);
  const resetIn = formatReset(reset);
  return (
    <div className="usage-win">
      <div className="usage-win-top">
        <span>{label}</span>
        <span className="num">{left === null ? "—" : `${left}% left`}</span>
      </div>
      <span className="usage-win-bar">
        <b style={{ width: `${left ?? 0}%` }} />
      </span>
      <div className="usage-win-foot">
        <span>{resetIn ? `resets in ${resetIn}` : "not started"}</span>
        {forecast?.state === "out" && forecast.outAt && (
          <span className="usage-win-out">out in {formatDuration(Math.max(0, forecast.outAt - Date.now()))}</span>
        )}
        {forecast?.state === "full" && <span className="usage-win-out">at the cap</span>}
      </div>
    </div>
  );
}

/** Live account usage, the T3-style dashboard that used to be only a title-bar strip. */
export function UsageSection({ notify }: SectionProps) {
  const accounts = useConfig((s) => s.config?.accounts ?? []);
  const usage = useUsage((s) => s.usage);
  const forecasts = useUsage((s) => s.forecasts);
  const fetchedAt = useUsage((s) => s.fetchedAt);

  useEffect(() => {
    for (const a of accounts) if (!(a.name in usage)) void useUsage.getState().refresh(a.name);
  }, [accounts, usage]);

  const refreshAll = () => {
    for (const a of accounts) void useUsage.getState().refresh(a.name, true);
    notify("Refreshing usage…");
  };

  return (
    <section className="set-group">
      <div className="usage-head">
        <h3>Claude usage</h3>
        <button type="button" onClick={refreshAll} disabled={!accounts.length}>
          Refresh all
        </button>
      </div>
      <p className="hint">
        What is left on each account's 5-hour and weekly windows. Live readings come from running panes; the rest is polled.
      </p>
      <div className="usage-table">
        {accounts.map((a) => {
          const u = usage[a.name];
          const f = forecasts[a.name];
          return (
            <div key={a.name} className="usage-row">
              <div className="usage-acct">
                <AgentLogo logo="claude" size={14} />
                <b>{a.name}</b>
                <span>{u?.source === "live" ? "live" : u ? "polled" : fetchedAt[a.name] ? "no data" : "loading…"}</span>
              </div>
              <Window label="5-hour" used={u?.fiveHour ?? null} reset={u?.fiveHourResetsAt ?? null} forecast={f?.["5h"]} />
              <Window label="Week" used={u?.sevenDay ?? null} reset={u?.sevenDayResetsAt ?? null} forecast={f?.["7d"]} />
              <button
                type="button"
                className="usage-refresh"
                onClick={() => {
                  void useUsage.getState().refresh(a.name, true);
                  notify(`Refreshing ${a.name}…`);
                }}
              >
                Refresh
              </button>
            </div>
          );
        })}
        {!accounts.length && <p className="hint">No accounts yet. Add one under Accounts.</p>}
      </div>
    </section>
  );
}
