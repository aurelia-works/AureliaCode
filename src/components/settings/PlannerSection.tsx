import { useRef, useState } from "react";
import { plannerCounts, type PlannerSwitches } from "../../lib/planner";
import { usePlanner } from "../../store/planner";
import type { SectionProps } from "./registry";

const SWITCHES: [keyof PlannerSwitches, string][] = [
  ["today", "Today: goals and day plan"],
  ["roadmap", "Roadmap lanes"],
  ["habits", "Habits"],
  ["focus", "Focus sessions"],
  ["signals", "Signals and daily briefing"],
  ["review", "Weekly review and journal"],
  ["calendar", "Calendar"],
];

export function PlannerSection({ notify }: SectionProps) {
  const data = usePlanner((s) => s.data);
  const [result, setResult] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      usePlanner.getState().importLinkraText(await f.text());
      setResult(`Imported ${f.name}`);
      notify("Planner imported");
    } catch (e) {
      setResult(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (file.current) file.current.value = "";
  };

  return (
    <section className="set-group">
      <h3>Planner</h3>
      <p className="hint">Linkra's planner, kept on this Mac in planner.json. Switches hide a feature without deleting its data.</p>
      {SWITCHES.map(([key, label]) => (
        <label key={key} className="field check">
          <input type="checkbox" checked={data.switches[key]} onChange={(e) => usePlanner.getState().setSwitch(key, e.target.checked)} />
          <span>{label}</span>
        </label>
      ))}
      <h3>Focus timer</h3>
      {(["focusMinutes", "breakMinutes"] as const).map((k) => (
        <label key={k} className="field">
          <span>{k === "focusMinutes" ? "Focus minutes" : "Break minutes"}</span>
          <input type="number" min={1} max={180} value={data.settings[k]} onChange={(e) => usePlanner.getState().update((s) => ({ ...s, settings: { ...s.settings, [k]: Math.min(180, Math.max(1, Math.round(Number(e.target.value)) || s.settings[k])) } }))} />
        </label>
      ))}
      <h3>Import</h3>
      <div className="field">
        <button onClick={() => file.current?.click()}>Import Linkra export…</button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      <p className="hint">Pick a linkra-export-*.json (schema 3). Importing again only adds what is missing; items you already have are kept as they are. GitHub tokens and billing fields are not copied.</p>
      {result && <p className="hint" role="status">{result}</p>}
      <p className="hint">{data.importedAt ? `Last import ${new Date(data.importedAt).toLocaleString()}` : "Nothing imported yet."}</p>
      <table className="planner-counts">
        <tbody>
          {plannerCounts(data).map((c) => (
            <tr key={c.key}>
              <td>{c.label}</td>
              <td>{c.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
