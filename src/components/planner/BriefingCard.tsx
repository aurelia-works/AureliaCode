import { useMemo } from "react";
import { briefing, dismissBriefing } from "../../lib/plannerSignals";
import { startPromptThread } from "../../lib/plannerThreads";
import { shiftDate } from "../../lib/plannerHabits";
import { usePlanner } from "../../store/planner";
import { useToday } from "./TodayPanel";
import { useSignals } from "./useSignals";

/** The morning card on the start screen: built once a day from goals, plan, waiting threads and signals. */
export function BriefingCard() {
  const date = useToday();
  const on = usePlanner((s) => s.data.switches.signals);
  const data = usePlanner((s) => s.data);
  const dismissed = data.dailyBriefings[date]?.dismissed;
  const { signals, waiting } = useSignals();
  const text = useMemo(() => briefing(data, signals, date, waiting, shiftDate(date, -1)), [data, signals, date, waiting]);

  if (!on || dismissed) return null;
  return (
    <section className="today briefing" aria-label="Daily briefing">
      <header className="today-head">
        <h2>Briefing</h2>
        <span className="chat-card-gap" />
        <button className="today-btn sm" onClick={() => void startPromptThread(`Here is my daily briefing. Summarise it and tell me what to do first.\n\n${text}`, null)}>
          Summarise
        </button>
        <button className="icon-btn sm" aria-label="Dismiss briefing" onClick={() => usePlanner.getState().update((s) => dismissBriefing(s, date, text))}>
          ×
        </button>
      </header>
      <p className="briefing-text">{text}</p>
    </section>
  );
}
