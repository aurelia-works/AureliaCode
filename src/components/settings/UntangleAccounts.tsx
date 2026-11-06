import { useEffect, useState } from "react";
import { useChat } from "../../lib/chat";
import { ipc } from "../../lib/ipc";
import { accountSessions, diskOrUnavailable, installAllowed, routeUntangleInstall, statusLabel, untangleAvail, type UntangleDisk } from "../../lib/untangle";
import { useConfig } from "../../store/config";
import { useLayout } from "../../store/layout";

/**
 * Settings → Accounts: place the bundled skill in one isolated Claude account.
 * The shared ~/.claude account stays untouched, and installing does not run the skill.
 */
export function UntangleAccounts() {
  const accounts = useConfig((s) => s.config?.accounts ?? []);
  const panes = useLayout((s) => s.panes);
  const chats = useChat((s) => s.byPane);
  const [byName, setByName] = useState<Record<string, UntangleDisk>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const key = accounts.map((a) => `${a.name}\t${a.configDir}`).join("\n");

  useEffect(() => {
    let live = true;
    const list = useConfig.getState().config?.accounts ?? [];
    for (const account of list) {
      ipc.untangleStatus(account.name).then(
        (disk) => {
          if (live) setByName((cur) => ({ ...cur, [account.name]: disk }));
        },
        () => {
          if (live) setByName((cur) => ({ ...cur, [account.name]: diskOrUnavailable(null, null) }));
        },
      );
    }
    return () => {
      live = false;
    };
  }, [key]);

  const install = async (name: string) => {
    if (busy) return;
    setBusy(name);
    setError("");
    try {
      const next = await routeUntangleInstall(
        { untangleStatus: (account) => ipc.untangleStatus(account), untangleInstall: (account) => ipc.untangleInstall(account) },
        name,
      );
      setByName((cur) => ({ ...cur, [name]: next }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="set-group" aria-label="Untangle codebase">
      <h3>Untangle codebase</h3>
      <p className="hint">
        Places the bundled <code>/untangle-codebase</code> skill in an isolated account's Claude skills folder. Installing does not run it and does not change any other skill.
        Status is not installed, installed but open sessions need a new launch, or ready for new sessions. The shared <code>~/.claude</code> account is refused.
      </p>
      <ul className="acct-list">
        {accounts.map((account) => {
          const disk = byName[account.name] ?? null;
          const avail = disk ? untangleAvail(disk, accountSessions(account.name, panes, chats)) : null;
          const allowed = !!disk && installAllowed(disk.state);
          return (
            <li key={account.name}>
              <div className="acct-row">
                <span className="account-chip">{account.name}</span>
                <span className="untangle-state">{avail ? statusLabel(avail.kind) : "Checking…"}</span>
                {allowed && (
                  <span className="acct-actions">
                    <button type="button" className="link-btn" disabled={busy === account.name} onClick={() => void install(account.name)}>
                      {disk?.state === "outdated" ? "Reinstall" : "Install"}
                    </button>
                  </span>
                )}
              </div>
              {avail && <p className="hint">{avail.reason}</p>}
              {disk?.skillDir && disk.state !== "unavailable" && (
                <p className="hint">
                  <code>{disk.skillDir}</code>
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="set-error">{error}</p>}
    </section>
  );
}
