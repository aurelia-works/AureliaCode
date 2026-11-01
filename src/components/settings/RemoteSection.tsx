import { useEffect, useState } from "react";
import { ipc, type RemoteStatus, type RemoteTest, type TailscaleInfo } from "../../lib/ipc";
import { useConfig } from "../../store/config";
import type { SectionProps } from "./registry";

const DEFAULTS = { enabled: false, port: 4747, allowLan: false, tailscaleHttps: false, httpsPort: 443, keepRunning: false };

/** Text with its https:// links clickable (opened in the default browser). */
function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https:\/\/\S+)/).map((part, i) =>
        part.startsWith("https://") ? (
          <a key={i} href={part} onClick={(e) => (e.preventDefault(), void ipc.openUrl(part))}>
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

function tailscaleLine(ts: TailscaleInfo): { tone: "ok" | "warn"; text: string } {
  switch (ts.state) {
    case "ready":
      return { tone: "ok", text: `Connected as ${ts.dnsName ?? ts.ip ?? "this Mac"}${ts.dnsName && ts.ip ? ` (${ts.ip})` : ""}.` };
    case "notInstalled":
      return { tone: "warn", text: "Tailscale isn't installed on this Mac. Get it at https://tailscale.com/download and sign in on this Mac and your phone." };
    case "loggedOut":
      return { tone: "warn", text: "Tailscale is logged out. Open the Tailscale menu bar app and sign in." };
    case "stopped":
      return { tone: "warn", text: "Tailscale is turned off. Turn it on from the Tailscale menu bar icon." };
    default:
      return { tone: "warn", text: `Tailscale isn't running. Open the Tailscale app.${ts.detail ? ` (${ts.detail})` : ""}` };
  }
}

function ago(secs: number): string {
  if (!secs) return "not seen yet";
  const d = Math.max(0, Date.now() / 1000 - secs);
  if (d < 90) return "seen just now";
  if (d < 3600 * 1.5) return `seen ${Math.round(d / 60)} min ago`;
  if (d < 86400 * 1.5) return `seen ${Math.round(d / 3600)} h ago`;
  return `seen ${Math.round(d / 86400)} days ago`;
}

export function RemoteSection({ draft, update, notify }: SectionProps) {
  const r = { ...DEFAULTS, ...draft.remote };
  const set = (patch: Partial<typeof r>) => update((c) => (c.remote = { ...r, ...patch }));
  const saved = useConfig((s) => s.config?.remote);
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [test, setTest] = useState<RemoteTest | "running" | null>(null);

  // Re-read after saves and every few seconds (Tailscale coming up, phones pairing).
  useEffect(() => {
    let alive = true;
    const load = () => ipc.remoteStatus().then((s) => alive && setStatus(s)).catch(() => {});
    load();
    const id = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [saved]);

  const copy = (url: string) => navigator.clipboard.writeText(url).then(() => notify("Link copied."), () => notify("Couldn't copy."));
  const runTest = async () => {
    setTest("running");
    setTest(await ipc.remoteTest().catch((e) => ({ ok: false, url: null, ms: null, error: String(e) })));
  };
  const ts = status?.tailscale;
  const line = ts && tailscaleLine(ts);
  const httpsUrl = ts?.dnsName ? `https://${ts.dnsName}${r.httpsPort === 443 ? "" : `:${r.httpsPort}`}` : null;
  const dirty = JSON.stringify({ ...DEFAULTS, ...saved }) !== JSON.stringify(r);

  return (
    <>
      <section className="set-group">
        <h3>Phone remote</h3>
        <label className="field check">
          <input type="checkbox" checked={r.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span>Control AureliaSpace from my phone's browser</span>
        </label>
        <p className="hint">See every pane, read and type into it, answer Claude's questions and open new agents, from anywhere on your Tailscale network.</p>
        <label className="field check">
          <input type="checkbox" checked={r.keepRunning} onChange={(e) => set({ keepRunning: e.target.checked })} />
          <span>Keep running when the window closes</span>
        </label>
        <p className="hint">The close button hides the window; agents and the phone remote keep going. Click the dock icon to bring it back.</p>
      </section>

      <section className="set-group">
        <h3>Tailscale</h3>
        {line ? (
          <p className={`remote-ts remote-ts-${line.tone}`}>
            <span className="remote-dot" aria-hidden />
            <span>
              <Linked text={line.text} />
            </span>
          </p>
        ) : (
          <p className="hint">Checking Tailscale…</p>
        )}
        <label className="field check">
          <input type="checkbox" checked={r.tailscaleHttps} onChange={(e) => set({ tailscaleHttps: e.target.checked })} />
          <span>Use Tailscale HTTPS{httpsUrl ? ` (${httpsUrl})` : ""}</span>
        </label>
        <p className="hint">
          A secure https:// address with a real certificate, through <code>tailscale serve</code>. The remote then only listens on this Mac; Tailscale
          forwards your phone to it.
        </p>
        {r.tailscaleHttps && ts && ts.state === "ready" && !ts.httpsAvailable && (
          <p className="hint warn">
            <Linked text="HTTPS certificates are off for your tailnet. Turn on HTTPS Certificates in the admin console: https://login.tailscale.com/admin/dns" />
          </p>
        )}
        {status?.serveError && (
          <p className="hint err">
            <Linked text={status.serveError} />
          </p>
        )}
        {status?.serving && <p className="hint ok">Serving at {httpsUrl}.</p>}
        {r.tailscaleHttps && (
          <label className="field">
            <span>HTTPS port</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={r.httpsPort}
              onChange={(e) => set({ httpsPort: Math.max(1, Math.min(65535, Number(e.target.value) || 443)) })}
            />
          </label>
        )}
        <label className="field check">
          <input type="checkbox" checked={r.allowLan} onChange={(e) => set({ allowLan: e.target.checked })} />
          <span>Also allow phones on the same Wi-Fi without Tailscale</span>
        </label>
        <label className="field">
          <span>Local port</span>
          <input
            type="number"
            min={1024}
            max={65535}
            value={r.port}
            onChange={(e) => set({ port: Math.max(1024, Math.min(65535, Number(e.target.value) || 4747)) })}
          />
        </label>
        {dirty && <p className="hint">Save to apply.</p>}
      </section>

      {status?.enabled && (
        <section className="set-group remote-pair">
          <h3>Pair a phone</h3>
          {status.error && <p className="hint err">Couldn't start: {status.error}</p>}
          {status.qrSvg ? (
            <div className="remote-qr-row">
              <div className="remote-qr" role="img" aria-label="Pairing QR code" dangerouslySetInnerHTML={{ __html: status.qrSvg }} />
              <div className="remote-qr-help">
                <p>Scan with your phone's camera while Tailscale is on. It opens AureliaSpace in the browser and remembers that phone.</p>
                <p className="hint">The code works once and for {Math.max(1, Math.round(status.codeExpiresIn / 60))} more min; a new one appears after.</p>
                <p className="hint">Tip: Share → Add to Home Screen makes it a full-screen app.</p>
              </div>
            </div>
          ) : (
            status.running && (
              <p className="hint">
                {status.serveError
                  ? `Tailscale Serve failed: ${status.serveError}. The plain Tailscale link below still works; fix Serve or turn off Tailscale HTTPS.`
                  : "The QR code appears once Tailscale is ready on this Mac."}
              </p>
            )
          )}
          {status.serveError && status.qrSvg && <p className="hint warn">Tailscale Serve failed: {status.serveError}. The HTTP link below is the fallback.</p>}
          {status.links.length > 0 && (
            <ul className="remote-links">
              {status.links.map((l) => (
                <li key={l.url}>
                  <span className="remote-link-label">{l.label}</span>
                  <code>{l.url.replace(/\/pair\?k=.*/, "")}</code>
                  <button type="button" onClick={() => copy(l.url)}>
                    Copy link
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="field-row">
            <button type="button" disabled={!status.running || test === "running"} onClick={runTest}>
              {test === "running" ? "Testing…" : "Test connection"}
            </button>
            {test && test !== "running" && (
              <span className={`hint ${test.ok ? "ok" : "err"}`}>
                {test.ok ? `Reachable at ${test.url} (${test.ms} ms).` : `${test.url ? `${test.url}: ` : ""}${test.error}`}
              </span>
            )}
          </div>
        </section>
      )}

      {status?.enabled && (
        <section className="set-group">
          <h3>Paired phones</h3>
          {status.devices.length === 0 ? (
            <p className="hint">No phones paired yet.</p>
          ) : (
            <ul className="remote-devices">
              {status.devices.map((d) => (
                <li key={d.id}>
                  <span className="remote-device-name">{d.name}</span>
                  <span className="hint">
                    paired {new Date(d.pairedAt * 1000).toLocaleDateString()} · {ago(d.lastSeen)}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      setStatus(await ipc.remoteUnpair(d.id));
                      notify(`Unpaired ${d.name}.`);
                    }}
                  >
                    Unpair
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            {status.clients === 0 ? "No phone connected right now." : status.clients === 1 ? "1 phone connected right now." : `${status.clients} phones connected right now.`}
          </p>
          {status.devices.length > 1 && (
            <div className="field-row">
              <button
                type="button"
                onClick={async () => {
                  setStatus(await ipc.remoteResetToken());
                  notify("All phones unpaired. Scan the QR code again to pair one.");
                }}
              >
                Unpair all phones
              </button>
            </div>
          )}
          <p className="hint">A paired phone can type into your terminals, so pair only your own devices.</p>
        </section>
      )}
    </>
  );
}
