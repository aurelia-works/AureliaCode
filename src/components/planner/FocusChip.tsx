import { useEffect, useState } from "react";
import { clock, remainingMs } from "../../lib/plannerHabits";
import { useFocus } from "../../store/focus";
import { usePlanner } from "../../store/planner";
import { TimerIcon } from "../Icons";

/** Title-bar focus timer: pick a project and start; shows the countdown and logs the session when it ends. */
export function FocusChip() {
  const on = usePlanner((s) => s.data.switches.focus);
  const minutes = usePlanner((s) => s.data.settings.focusMinutes);
  const projects = usePlanner((s) => s.data.projects);
  const running = useFocus((s) => s.running);
  const [now, setNow] = useState(Date.now());
  const [menu, setMenu] = useState(false);
  const [project, setProject] = useState("");

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => {
    if (running && remainingMs(running, now) === 0) useFocus.getState().stop();
  }, [running, now]);

  if (!on) return null;
  if (running) {
    return (
      <button className="tb-focus on num" title="Stop this focus session and log it" onClick={() => useFocus.getState().stop()}>
        {clock(remainingMs(running, now))} · stop
      </button>
    );
  }
  return (
    <span className="tb-focus-wrap">
      <button className="tb-focus icon" aria-expanded={menu} aria-label="Start a focus session" title="Start a focus session" onClick={() => setMenu(!menu)}>
        <TimerIcon />
      </button>
      {menu && (
        <div className="tb-focus-menu" role="dialog" aria-label="Start focus">
          <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
            <option value="">No project</option>
            {projects.filter((p) => !p.archivedAt).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="today-btn"
            onClick={() => {
              useFocus.getState().start(project || null);
              setNow(Date.now());
              setMenu(false);
            }}
          >
            Start {minutes} min
          </button>
        </div>
      )}
    </span>
  );
}
