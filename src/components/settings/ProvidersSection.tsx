import { useEffect, useState } from "react";
import { CAP_LABELS, signInLine, sortProviders, type ProviderStatus } from "../../lib/providers";
import { loadProviders, useProviders } from "../../store/providers";
import type { SectionProps } from "./registry";

/** The agent CLIs on this Mac as their own status commands report them. */
export function ProvidersSection(_: SectionProps) {
  const { list, loading, error } = useProviders();
  useEffect(() => void loadProviders(), []);
  return (
    <section className="set-group">
      <div className="set-head">
        <h3>Providers</h3>
        <button type="button" onClick={() => void loadProviders(true)} disabled={loading}>
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>
      <p className="hint">
        Each CLI's own status command (<code>claude auth status</code>, <code>opencode auth list</code>, <code>grok models</code>, <code>codex login status</code>; Gemini's settings file). No key or token is read.
      </p>
      {error && <p className="set-error">Couldn't check: {error}</p>}
      {!list && !error && <p className="hint">Checking the installed CLIs…</p>}
      <ul className="prov-list">
        {list && sortProviders(list).map((p) => <ProviderRow key={p.id} p={p} />)}
      </ul>
    </section>
  );
}

function ProviderRow({ p }: { p: ProviderStatus }) {
  const [open, setOpen] = useState(false);
  const state = !p.installed ? "missing" : p.signedIn === false ? "out" : p.signedIn ? "in" : "unknown";
  return (
    <li className={`prov ${state}`}>
      <div className="prov-top">
        <span className="prov-dot" aria-hidden />
        <span className="prov-name">{p.label}</span>
        {p.version && <span className="prov-ver num">{p.version}</span>}
        <span className="prov-auth">{signInLine(p)}</span>
      </div>
      {p.installed && (
        <div className="prov-meta">
          {p.email && <span>{p.email}</span>}
          {p.path && (
            <span className="prov-path" title={p.path}>
              {p.path}
            </span>
          )}
          {p.caps.length > 0 && (
            <span className="prov-caps">
              {p.caps.map((c) => (
                <span key={c} className="prov-cap">
                  {CAP_LABELS[c] ?? c}
                </span>
              ))}
            </span>
          )}
          {p.models.length > 0 && (
            <button type="button" className="link-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {p.models.length} model{p.models.length > 1 ? "s" : ""}
              {p.defaultModel ? `, default ${p.defaultModel}` : ""}
            </button>
          )}
          {p.error && <span className="prov-err">{p.error}</span>}
        </div>
      )}
      {open && (
        <ul className="prov-models num">
          {p.models.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
