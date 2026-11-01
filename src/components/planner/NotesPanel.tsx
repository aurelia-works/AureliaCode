import { useState } from "react";
import { expandPath } from "../../lib/format";
import type { JournalEntry } from "../../lib/planner";
import { projectForDir } from "../../lib/plannerToday";
import { addJournal, journalFor, removeJournal, scratchFor, setScratch } from "../../lib/plannerWeekly";
import { paneDir } from "../../store/git";
import { useLayout } from "../../store/layout";
import { usePlanner } from "../../store/planner";

const TYPES: JournalEntry["type"][] = ["note", "decision", "blocker", "next", "idea"];

/** Right-panel tab: the focused thread's project journal and scratchpad (the "no project" ones when it has none). */
export function NotesPanel() {
  const data = usePlanner((s) => s.data);
  const focused = useLayout((s) => s.tabs.find((t) => t.id === s.activeTabId)?.focusedPaneId);
  const dir = focused ? paneDir(focused) : undefined;
  const project = projectForDir(data.projects, dir, expandPath);
  const pid = project?.id ?? null;
  const [body, setBody] = useState("");
  const [type, setType] = useState<JournalEntry["type"]>("note");
  const up = usePlanner.getState().update;
  const entries = journalFor(data, pid);
  return (
    <div className="notes" aria-label="Notes">
      <h3 className="today-sub">Scratchpad · {project?.name ?? "No project"}</h3>
      <textarea className="notes-scratch" rows={6} value={scratchFor(data, pid)} onChange={(e) => up((s) => setScratch(s, pid, e.target.value))} placeholder="Free notes for this project" aria-label="Scratchpad" />
      <h3 className="today-sub">Journal</h3>
      <form
        className="notes-add"
        onSubmit={(e) => {
          e.preventDefault();
          up((s) => addJournal(s, pid, type, body));
          setBody("");
        }}
      >
        <select value={type} onChange={(e) => setType(e.target.value as JournalEntry["type"])} aria-label="Entry type">
          {TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write an entry" aria-label="Journal entry" />
      </form>
      <ul className="notes-list">
        {entries.map((j) => (
          <li key={j.id}>
            <span className="pts">
              {j.type} · {new Date(j.ts).toLocaleDateString()}
            </span>
            <span className="t">{j.body}</span>
            <button className="icon-btn sm" aria-label="Delete entry" onClick={() => up((s) => removeJournal(s, j.id))}>×</button>
          </li>
        ))}
        {!entries.length && <li className="empty">No entries yet.</li>}
      </ul>
    </div>
  );
}
