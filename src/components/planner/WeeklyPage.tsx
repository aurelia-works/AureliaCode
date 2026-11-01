import { useEffect, useState } from "react";
import { shiftDate } from "../../lib/plannerHabits";
import { localDate } from "../../lib/plannerToday";
import { reviewFor, saveReview, weekEnd, weekMarkdown, weekStart, weekStats } from "../../lib/plannerWeekly";
import { usePlanner } from "../../store/planner";
import { useUi } from "../../store/ui";

/** Full-screen weekly review: this week's numbers from what happened, notes, and Close week. */
export function WeeklyPage() {
  const open = useUi((s) => s.weeklyOpen);
  const data = usePlanner((s) => s.data);
  const [start, setStart] = useState(() => weekStart(localDate()));
  const saved = reviewFor(data, start);
  const [notes, setNotes] = useState("");
  const close = () => useUi.getState().set({ weeklyOpen: false });

  useEffect(() => {
    if (open) setStart(weekStart(localDate()));
  }, [open]);
  useEffect(() => {
    setNotes(typeof saved?.notes === "string" ? saved.notes : "");
  }, [start, open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !(e.target instanceof HTMLTextAreaElement) && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const st = weekStats(data, start);
  const rows: [string, string][] = [
    ["Goals done", `${st.goalsCompleted} (${st.goalPoints} pts, avg ${st.avgScore}%)`],
    ["Threads settled", String(st.threadsSettled)],
    ["PRs merged", String(st.prsMerged)],
    ["Cards shipped", String(st.cardsShipped)],
    ["Project tasks done", String(st.tasksDone)],
    ["Habit check-ins", String(st.habitCheckins)],
    ["Focus", `${st.focusMinutes} min · ${st.focusSessions} sessions`],
    ["Journal entries", String(st.journalCount)],
  ];
  const past = data.weeklyReviews.filter((r) => typeof r.weekStart === "string").sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart))).slice(0, 8);
  return (
    <div className="roadmap-page weekly" role="dialog" aria-label="Weekly review">
      <header className="roadmap-head">
        <h2>Weekly review</h2>
        <button className="icon-btn sm" aria-label="Previous week" onClick={() => setStart(shiftDate(start, -7))}>←</button>
        <span>
          {start} to {weekEnd(start)}
        </span>
        <button className="icon-btn sm" aria-label="Next week" onClick={() => setStart(shiftDate(start, 7))}>→</button>
        {saved?.closedAt ? <span className="pts">closed {new Date(String(saved.closedAt)).toLocaleDateString()}</span> : null}
        <span className="chat-card-gap" />
        <button className="today-btn" onClick={close}>
          Close <kbd>Esc</kbd>
        </button>
      </header>
      <div className="weekly-body">
        <table className="planner-counts">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What went well, what to change next week" aria-label="Week notes" />
        <div className="rcard-bar">
          <button className="today-btn" onClick={() => usePlanner.getState().update((s) => saveReview(s, start, notes, false))}>
            Save notes
          </button>
          <button className="today-btn" onClick={() => usePlanner.getState().update((s) => saveReview(s, start, notes, true))}>
            Close week
          </button>
          <button className="today-btn" onClick={() => void navigator.clipboard?.writeText(weekMarkdown(start, st, notes))}>
            Copy as markdown
          </button>
        </div>
        {past.length > 0 && (
          <>
            <h3 className="today-sub">Past reviews</h3>
            <ul className="today-list">
              {past.map((r) => (
                <li key={r.id}>
                  <button className="today-btn sm" onClick={() => setStart(String(r.weekStart))}>
                    {String(r.weekStart)}
                  </button>
                  <span className="pts">{r.closedAt ? "closed" : "open"}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
