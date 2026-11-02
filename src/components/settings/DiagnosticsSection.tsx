import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { db } from "../../lib/db";
import { ipc } from "../../lib/ipc";
import { applyAppearance } from "../../lib/terminals";
import { applyUiAppearance } from "../../lib/uiAppearance";
import { useConfig } from "../../store/config";
import type { SectionProps } from "./registry";

type Health = { ok: boolean; threads: number; events: number; path: string };

/** Runtime and local-store facts, plus the two folders people actually need to open. */
export function DiagnosticsSection({ notify }: SectionProps) {
  const [version, setVersion] = useState("dev");
  const [tauri, setTauri] = useState("—");
  const [store, setStore] = useState<Health | null>(null);

  useEffect(() => {
    void getVersion().then((v) => setVersion(v || "dev"), () => setVersion("dev"));
    void getTauriVersion().then((v) => setTauri(v || "—"), () => setTauri("—"));
    void db.health().then(setStore, () => setStore(null));
  }, []);

  const reload = async () => {
    await useConfig.getState().load();
    applyAppearance();
    applyUiAppearance();
    notify("Reloaded config.json. Reopen Settings to edit the new values.");
  };

  const copy = () => {
    const text = [
      `AureliaSpace ${version}`,
      `Tauri ${tauri}`,
      `WebView ${navigator.userAgent}`,
      `Store ${store?.ok ? `${store.threads} threads, ${store.events} events` : "unavailable"}`,
      `Store path ${store?.path ?? "—"}`,
    ].join("\n");
    void navigator.clipboard.writeText(text).then(
      () => notify("Diagnostics copied"),
      () => notify("Could not copy diagnostics"),
    );
  };

  return (
    <>
      <section className="set-group">
        <h3>Runtime</h3>
        <dl className="diag-list">
          <div>
            <dt>App</dt>
            <dd>{version}</dd>
          </div>
          <div>
            <dt>Tauri</dt>
            <dd>{tauri}</dd>
          </div>
          <div>
            <dt>WebView</dt>
            <dd className="diag-ua">{navigator.userAgent}</dd>
          </div>
        </dl>
      </section>

      <section className="set-group">
        <h3>Local store</h3>
        <p className="hint">
          {store
            ? store.ok
              ? `${store.threads} threads and ${store.events} events in SQLite. This survives a restart and powers search; live state is still in layout.json.`
              : `The local store couldn't open: ${store.path}`
            : "Opening the local store…"}
        </p>
        <div className="field-row">
          <button type="button" onClick={() => void ipc.revealConfig(false)}>
            Reveal config folder
          </button>
          <button type="button" onClick={() => void ipc.revealConfig(true)}>
            Edit config.json
          </button>
          <button type="button" onClick={reload}>
            Reload from disk
          </button>
          {store?.ok && (
            <button type="button" onClick={() => void ipc.openPath(store.path.replace(/\/[^/]*$/, ""))}>
              Reveal database
            </button>
          )}
          <button type="button" onClick={copy}>
            Copy diagnostics
          </button>
        </div>
      </section>
    </>
  );
}
