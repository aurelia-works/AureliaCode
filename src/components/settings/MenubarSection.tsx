import { useEffect, useState } from "react";
import { ipc } from "../../lib/ipc";
import type { SectionProps } from "./registry";

const VENDORS = [
  { id: "anthropic", label: "Anthropic Admin key", hint: "sk-ant-admin…, from Console → Settings → Admin keys" },
  { id: "openai", label: "OpenAI Admin key", hint: "From Platform → Organization → Admin keys" },
] as const;

function SpendKey({ id, label, hint, notify }: (typeof VENDORS)[number] & { notify(msg: string): void }) {
  const [has, setHas] = useState(false);
  const [key, setKey] = useState("");
  useEffect(() => void ipc.spendKeyHas(id).then(setHas).catch(() => {}), [id]);
  const save = async () => {
    try {
      await ipc.spendKeySet(id, key);
      setHas(!!key.trim());
      setKey("");
      notify(key.trim() ? "Key saved to Keychain." : "Key removed.");
    } catch (e) {
      notify(String(e));
    }
  };
  return (
    <label className="field">
      <span>{label}</span>
      <div className="field-row">
        <input type="password" value={key} placeholder={has ? "Saved in Keychain" : hint} onChange={(e) => setKey(e.target.value)} spellCheck={false} />
        <button type="button" disabled={!key && !has} onClick={save}>
          {key ? "Save" : "Remove"}
        </button>
      </div>
    </label>
  );
}

export function MenubarSection({ draft, update, notify }: SectionProps) {
  const t = draft.tray;
  return (
    <>
      <section className="set-group">
        <h3>Menu bar squid</h3>
        <label className="field check">
          <input type="checkbox" checked={t.enabled} onChange={(e) => update((c) => (c.tray.enabled = e.target.checked))} />
          <span>Show the squid in the menu bar</span>
        </label>
        <label className="field check">
          <input type="checkbox" checked={t.animate} onChange={(e) => update((c) => (c.tray.animate = e.target.checked))} />
          <span>Sway while a thread is working</span>
        </label>
        <label className="field">
          <span>Size</span>
          <input type="range" min={14} max={22} value={t.size} onChange={(e) => update((c) => (c.tray.size = Number(e.target.value)))} />
        </label>
        <label className="field">
          <span>Colour</span>
          <div className="field-row">
            <input type="color" value={t.color || "#ffffff"} onChange={(e) => update((c) => (c.tray.color = e.target.value))} />
            <button type="button" disabled={!t.color} onClick={() => update((c) => (c.tray.color = ""))}>
              Match menu bar
            </button>
          </div>
        </label>
      </section>

      <section className="set-group">
        <h3>Privacy</h3>
        <label className="field check">
          <input type="checkbox" checked={t.streamer} onChange={(e) => update((c) => (c.tray.streamer = e.target.checked))} />
          <span>Streamer mode: blur account details</span>
        </label>
        <p className="hint">They clear after 3 seconds under the pointer, or on a click.</p>
      </section>

      <section className="set-group">
        <h3>Real API spend</h3>
        <p className="hint">Read from each vendor's cost report. Keys stay in the Keychain. Without one the menu bar says “Not available”.</p>
        {VENDORS.map((v) => (
          <SpendKey key={v.id} {...v} notify={notify} />
        ))}
      </section>
    </>
  );
}
