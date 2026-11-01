import { useState } from "react";
import { addHabit, archiveHabit, doneOn, dueToday, focusMinutesOn, streak, toggleHabit } from "../../lib/plannerHabits";
import { usePlanner } from "../../store/planner";
import { useToday } from "./TodayPanel";

/** Today's habits with streaks, plus the day's focus minutes. Start screen only. */
export function HabitsPanel() {
  const data = usePlanner((s) => s.data);
  const date = useToday();
  const [text, setText] = useState("");
  const up = usePlanner.getState().update;
  if (!data.switches.habits && !data.switches.focus) return null;
  const habits = dueToday(data, date);
  const mins = focusMinutesOn(data, date);
  return (
    <section className="today habits" aria-label="Habits">
      <header className="today-head">
        <h2>Habits</h2>
        {data.switches.focus && <span className="today-score" title="Focus time today">{mins} min focus</span>}
      </header>
      {data.switches.habits && (
        <>
          <ul className="today-list">
            {habits.map((h) => {
              const done = doneOn(data.habitCompletions, h.id, date);
              const n = streak(h, data.habitCompletions, date);
              return (
                <li key={h.id} className={done ? "done" : ""}>
                  <input type="checkbox" checked={done} onChange={() => up((s) => toggleHabit(s, h.id, date))} aria-label={`Done: ${h.title}`} />
                  <span className="t">{h.title}</span>
                  <span className="pts" title={`Target ${h.targetStreak} days`}>{n} day streak</span>
                  <button className="icon-btn sm" aria-label="Archive habit" onClick={() => up((s) => archiveHabit(s, h.id))}>×</button>
                </li>
              );
            })}
            {!habits.length && <li className="empty">No habits due today.</li>}
          </ul>
          <form
            className="today-add"
            onSubmit={(e) => {
              e.preventDefault();
              up((s) => addHabit(s, text));
              setText("");
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a daily habit" aria-label="Add a habit" />
          </form>
        </>
      )}
    </section>
  );
}
