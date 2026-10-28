import { useEffect, useState } from "react";
import { capture, localDate } from "../../lib/plannerToday";
import { usePlanner } from "../../store/planner";
import { toast, useUi } from "../../store/ui";

/** Palette "Capture…": one line to today's goals or a project's tasks. */
export function CaptureBox() {
  const open = useUi((s) => s.captureOpen);
  const allProjects = usePlanner((s) => s.data.projects);
  const projects = allProjects.filter((p) => !p.archivedAt);
  const [text, setText] = useState("");
  const [dest, setDest] = useState("today");
  useEffect(() => {
    if (open) {
      setText("");
      setDest("today");
    }
  }, [open]);
  if (!open) return null;
  const close = () => useUi.getState().set({ captureOpen: false });
  const submit = () => {
    if (!text.trim()) return;
    usePlanner.getState().update((s) => capture(s, dest === "today" ? "today" : { projectId: dest }, text, localDate()));
    toast(dest === "today" ? "Added to today" : "Added to the project");
    close();
  };
  return (
    <div className="scrim top" onMouseDown={close}>
      <div className="cmdk capture" role="dialog" aria-label="Capture" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && close()}>
        <div className="cmdk-input">
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Capture a thought, goal or task…" spellCheck={false} aria-label="Capture" />
          <select value={dest} onChange={(e) => setDest(e.target.value)} aria-label="Where to">
            <option value="today">Today</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <kbd>↵</kbd>
        </div>
      </div>
    </div>
  );
}
