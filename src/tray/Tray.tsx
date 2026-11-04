import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatCost, formatTokens } from "../lib/format";
import { ipc, type Identity, type LedgerSummary, type RealSpend, type Usage } from "../lib/ipc";
import { squidPaths } from "../lib/squid";

const RANGES = ["24h", "7d", "30d"] as const;
type Range = (typeof RANGES)[number];
const VENDOR: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI" };

/** Account details under streamer mode: blurred, clearing slowly after 3 s hover, or on click. */
function Private({ on, children }: { on: boolean; children: string }) {
  const [shown, setShown] = useState(false);
  if (!on) return <span>{children}</span>;
  return (
    <span className={`private${shown ? " shown" : ""}`} onClick={() => setShown(!shown)}>
      {children}
    </span>
  );
}

function until(iso: string | null): string {
  const t = iso ? Date.parse(iso) - Date.now() : NaN;
  if (!Number.isFinite(t) || t <= 0) return "";
  const h = Math.floor(t / 3_600_000);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${Math.floor(t / 60_000) % 60}m`;
}

function Meter({ label, pct, reset }: { label: string; pct: number | null; reset: string | null }) {
  const left = until(reset);
  return (
    <div className="tray-meter">
      <span className="tray-meter-name">{label}</span>
      <span className="tray-bar">
        <span className={(pct ?? 0) >= 90 ? "hot" : ""} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
      </span>
      <span className="tray-num">{pct === null ? "–" : `${Math.round(pct)}%`}</span>
      <span className="tray-reset">{left}</span>
    </div>
  );
}

function Squid() {
  return (
    <svg width="16" height="16" viewBox="0 0 22 22" aria-hidden>
      <path d={squidPaths(0).body} fill="currentColor" />
      <path d={squidPaths(0).arms} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function Tray() {
  const [range, setRange] = useState<Range>("7d");
  const [people, setPeople] = useState<Identity[]>([]);
  const [usage, setUsage] = useState<Record<string, Usage | null>>({});
  const [bill, setBill] = useState<LedgerSummary | null>(null);
  const [spend, setSpend] = useState<RealSpend[]>([]);
  const [streamer, setStreamer] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    ipc.getConfig().then((c) => setStreamer(!!c.tray?.streamer)).catch(() => {});
    ipc.trayAccounts().then((list) => {
      setPeople(list);
      for (const p of list) ipc.fetchUsage(p.name).then((u) => setUsage((m) => ({ ...m, [p.name]: u }))).catch(() => {});
    }).catch(() => {});
    ipc.ledgerSummary().then(setBill).catch(() => {});
    ipc.realSpend().then(setSpend).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const un = listen("tray-opened", load);
    return () => void un.then((f) => f());
  }, [load]);

  useEffect(() => {
    if (!panel.current) return;
    const ro = new ResizeObserver(() => invoke("tray_resize", { height: Math.ceil(panel.current!.getBoundingClientRect().height) }).catch(() => {}));
    ro.observe(panel.current);
    return () => ro.disconnect();
  }, []);

  const w = bill?.windows.find((x) => x.id === range);
  const col = RANGES.indexOf(range);
  return (
    <div className="tray-panel" ref={panel}>
      <header className="tray-head">
        <span className="tray-brand">
          <Squid />
          AureliaCode
        </span>
        <span className="tray-seg">
          {RANGES.map((r) => (
            <button key={r} className={r === range ? "on" : ""} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </span>
      </header>

      <section className="tray-sec">
        {people.map((p) => {
          const u = usage[p.name];
          return (
            <div className="tray-account" key={p.name}>
              <div className="tray-who">
                <Private on={streamer}>{p.email ?? p.name}</Private>
                {p.plan && <span className="tray-plan">{p.plan}</span>}
              </div>
              <Meter label="5h" pct={u?.fiveHour ?? null} reset={u?.fiveHourResetsAt ?? null} />
              <Meter label="7d" pct={u?.sevenDay ?? null} reset={u?.sevenDayResetsAt ?? null} />
            </div>
          );
        })}
      </section>

      <section className="tray-sec">
        <div className="tray-row tray-total">
          <span>At API prices</span>
          <b className="num">{w ? formatCost(w.usd) : "…"}</b>
        </div>
        <div className="tray-row">
          <span>Claude</span>
          <span className="num">{w ? `${formatTokens(w.tokens)} tokens` : ""}</span>
        </div>
        {w?.models.slice(0, 4).map((m) => (
          <div className="tray-row sub" key={m.model}>
            <span>{m.model}</span>
            <span className="num">{formatCost(m.usd)}</span>
          </div>
        ))}
        {!!w?.unpriced.length && <p className="tray-note">No list price for {w.unpriced.join(", ")}: left out.</p>}
        {bill && !bill.pricesAt && <p className="tray-note">Couldn't get the price list.</p>}
        <div className="tray-row">
          <span>Codex</span>
          <span className="tray-off">Not available</span>
        </div>
      </section>

      <section className="tray-sec">
        <div className="tray-label">Real API spend</div>
        {spend.map((s) => (
          <div className="tray-row" key={s.provider}>
            <span>{VENDOR[s.provider] ?? s.provider}</span>
            {s.days ? <span className="num">{formatCost(s.days[col])}</span> : <span className="tray-off" title={s.note ?? undefined}>Not available</span>}
          </div>
        ))}
      </section>

      <footer className="tray-foot">
        {bill?.pricesAt ? <span>Prices from {new Date(bill.pricesAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span> : <span />}
        <button onClick={() => invoke("tray_open_main").catch(() => {})}>Open AureliaCode</button>
      </footer>
    </div>
  );
}
