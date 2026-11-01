import { useEffect, useState } from "react";
import { addGoal, addPlanItem, ensureDay, localDate, moveGoal, movePlanItem, planItems, planPrompt, removeGoal, removePlanItem, toggleGoal, togglePlanItem, writePlan } from "../../lib/plannerToday";
import type { Goal } from "../../lib/planner";
import { usePlanner } from "../../store/planner";

/** Today's date, re-read each minute so the panel rolls over at local midnight. */
export function useToday(): string {
  const [d, setD] = useState(localDate());
  useEffect(() => {
    const t = setInterval(() => setD(localDate()), 30_000);
    return () => clearInterval(t);
  }, []);
  return d;
}

/** Goals with points and a score, plus the day's plan queue. Start screen only. */
export function TodayPanel({ onStart }: { onStart(prompt: string, projectId: string | null): void }) {
  const on = usePlanner((s) => s.data.switches.today);
  const loaded = usePlanner((s) => s.loaded);
  const data = usePlanner((s) => s.data);
  const date = useToday();
  const [goalText, setGoalText] = useState("");
  const [goalProject, setGoalProject] = useState("");
  const [planText, setPlanText] = useState("");
  const [pasting, setPasting] = useState(false);
  const up = usePlanner.getState().update;

  useEffect(() => {
    if (loaded && on) up((s) => ensureDay(s, date));
  }, [loaded, on, date]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!on) return null;
  const day = data.dailyGoalsByDate[date];
  const goals = day?.goals ?? [];
  const items = planItems(data, date);
  const activeProjects = data.projects.filter((p) => !p.archivedAt);
  const effectiveProject = activeProjects.some((p) => p.id === goalProject) ? goalProject : "";
  const project = (g: Goal) => data.projects.find((p) => p.id === g.projectId);

  return (
    <section className="today" aria-label="Today">
      <header className="today-head">
        <h2>Today</h2>
        <span className="today-score" title={`${day?.completedPoints ?? 0} of ${day?.totalPoints ?? 0} points`}>
          {day?.score ?? 0}%
        </span>
        <span className="chat-card-gap" />
        <button className="today-btn" onClick={() => onStart(planPrompt(data, date), null)}>
          Plan my day
        </button>
      </header>
      <ul className="today-list">
        {goals.map((g) => (
          <li key={g.id} className={g.done ? "done" : ""}>
            <input type="checkbox" checked={g.done} onChange={() => up((s) => toggleGoal(s, date, g.id))} aria-label={`Done: ${g.title}`} />
            <span className="t">{g.title}</span>
            <span className="pts">{g.points} pts</span>
            {!g.done && (
              <button className="today-btn sm" title={project(g) ? `Start in ${project(g)!.name}` : "Start a chat on this goal"} onClick={() => onStart(g.title, g.projectId ?? null)}>
                Start thread
              </button>
            )}
            <button className="icon-btn sm" aria-label="Move up" onClick={() => up((s) => moveGoal(s, date, g.id, -1))}>↑</button>
            <button className="icon-btn sm" aria-label="Move down" onClick={() => up((s) => moveGoal(s, date, g.id, 1))}>↓</button>
            <button className="icon-btn sm" aria-label="Remove goal" onClick={() => up((s) => removeGoal(s, date, g.id))}>×</button>
          </li>
        ))}
      </ul>
      <form
        className="today-add"
        onSubmit={(e) => {
          e.preventDefault();
          up((s) => addGoal(s, date, goalText, { projectId: effectiveProject || null }));
          setGoalText("");
        }}
      >
        <input value={goalText} onChange={(e) => setGoalText(e.target.value)} placeholder="Add a goal" aria-label="Add a goal" />
        <select value={effectiveProject} onChange={(e) => setGoalProject(e.target.value)} aria-label="Goal project" title="Where Start thread opens">
          <option value="">No project</option>
          {activeProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </form>
      <h3 className="today-sub">Plan</h3>
      <ul className="today-list">
        {items.map((it) => (
          <li key={it.id} className={it.done ? "done" : ""}>
            <input type="checkbox" checked={it.done} onChange={() => up((s) => togglePlanItem(s, date, it.id))} aria-label={`Done: ${it.text}`} />
            <span className="t">{it.text}</span>
            <button className="icon-btn sm" aria-label="Move up" onClick={() => up((s) => movePlanItem(s, date, it.id, -1))}>↑</button>
            <button className="icon-btn sm" aria-label="Move down" onClick={() => up((s) => movePlanItem(s, date, it.id, 1))}>↓</button>
            <button className="icon-btn sm" aria-label="Remove item" onClick={() => up((s) => removePlanItem(s, date, it.id))}>×</button>
          </li>
        ))}
        {!items.length && <li className="empty">Nothing planned. Add an item or paste a plan.</li>}
      </ul>
      <form
        className="today-add"
        onSubmit={(e) => {
          e.preventDefault();
          up((s) => addPlanItem(s, date, planText));
          setPlanText("");
        }}
      >
        <input value={planText} onChange={(e) => setPlanText(e.target.value)} placeholder="Add a plan item" aria-label="Add a plan item" />
        <button type="button" className="today-btn sm" onClick={() => setPasting(!pasting)}>
          Paste a plan
        </button>
      </form>
      {pasting && <PastePlan onDone={(t) => { if (t.trim()) up((s) => writePlan(s, date, t)); setPasting(false); }} />}
    </section>
  );
}

function PastePlan({ onDone }: { onDone(text: string): void }) {
  const [t, setT] = useState("");
  return (
    <div className="today-paste">
      <textarea rows={4} value={t} onChange={(e) => setT(e.target.value)} placeholder="Paste the reply from Plan my day: one item per line" aria-label="Pasted plan" />
      <button className="today-btn" onClick={() => onDone(t)}>
        Replace the plan
      </button>
    </div>
  );
}
