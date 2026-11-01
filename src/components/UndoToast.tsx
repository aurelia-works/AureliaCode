import { useEffect, useState } from "react";
import { latestEntry } from "../lib/undo";
import { runUndo, useUndo } from "../store/undo";
import { useUi } from "../store/ui";

/** "Closed 1 thread · Undo (⌘Z)" for as long as the undo window lasts. */
export function UndoToast() {
  const entries = useUndo((s) => s.entries);
  const on = useUi((s) => s.prefs.undo);
  const [now, setNow] = useState(Date.now());
  const latest = latestEntry(entries, now);
  useEffect(() => {
    if (!latest) return;
    const t = setTimeout(() => setNow(Date.now()), Math.max(50, latest.until - Date.now() + 20));
    return () => clearTimeout(t);
  }, [latest?.id, latest?.until]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setNow(Date.now()), [entries]);
  if (!on || !latest) return null;
  return (
    <div className="undo-toast" role="status" key={latest.id}>
      <span>{latest.label}</span>
      <button onClick={() => runUndo()}>Undo <kbd>⌘Z</kbd></button>
    </div>
  );
}
