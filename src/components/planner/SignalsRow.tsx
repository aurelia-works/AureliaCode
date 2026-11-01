import { useState } from "react";
import { SNOOZES, snooze } from "../../lib/plannerSignals";
import { startPromptThread } from "../../lib/plannerThreads";
import { usePlanner } from "../../store/planner";
import { useSignals } from "./useSignals";

/** Project-health warnings at the top of the Board: start a thread on one, or snooze it. */
export function SignalsRow() {
  const { signals } = useSignals();
  const on = usePlanner((s) => s.data.switches.signals);
  const [menu, setMenu] = useState<string | null>(null);
  if (!on || !signals.length) return null;
  return (
    <section className="signals" aria-label="Signals">
      <h2>Signals</h2>
      <ul>
        {signals.slice(0, 8).map((x) => (
          <li key={x.id} className={`sig ${x.severity}`}>
            <span className="sig-dot" aria-label={x.severity} />
            <span className="sig-what">
              <b>{x.title}</b>
              <span>{x.reason}</span>
            </span>
            <button className="today-btn sm" onClick={() => void startPromptThread(x.prompt, x.projectId)}>
              Start thread
            </button>
            <span className="tb-focus-wrap">
              <button className="today-btn sm" aria-expanded={menu === x.id} onClick={() => setMenu(menu === x.id ? null : x.id)}>
                Snooze
              </button>
              {menu === x.id && (
                <div className="tb-focus-menu" role="menu">
                  {SNOOZES.map((o) => (
                    <button
                      key={o.label}
                      role="menuitem"
                      className="today-btn sm"
                      onClick={() => {
                        usePlanner.getState().update((s) => snooze(s, x.id, o.ms));
                        setMenu(null);
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
