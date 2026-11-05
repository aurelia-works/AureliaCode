import { useEffect, useState } from "react";
import { SNOOZES, snooze } from "../../lib/plannerSignals";
import { startPromptThread } from "../../lib/plannerThreads";
import { usePlanner } from "../../store/planner";
import { useSignals } from "./useSignals";
import { useUi } from "../../store/ui";
import { ChevronIcon } from "../Icons";

/** Project-health warnings at the top of the Board: start a thread on one, or snooze it. */
export function SignalsRow() {
  const { signals } = useSignals();
  const on = usePlanner((s) => s.data.switches.signals);
  const [menu, setMenu] = useState<string | null>(null);
  const folded = useUi((s) => s.prefs.signalsFolded);
  const [open, setOpen] = useState(!folded);
  useEffect(() => setOpen(!folded), [folded]);
  if (!on || !signals.length) return null;
  const urgent = signals.filter((x) => x.severity === "crit").length;
  return (
    <section className={`signals${open ? "" : " folded"}`} aria-label="Signals">
      <h2>
        <button type="button" className="link-btn signals-fold" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronIcon className={`chat-chev ${open ? "down" : "right"}`} width={12} height={12} />
          Signals
          <span className="num"> · {signals.length}{urgent ? `, ${urgent} urgent` : ""}</span>
        </button>
      </h2>
      {open && (
      <ul>
        {signals.slice(0, 8).map((x) => (
          <li key={x.id} className={`sig ${x.severity}`}>
            {x.severity === "crit" ? <span className="sig-tag">Urgent</span> : <span className="sig-dot" aria-hidden />}
            <span className="sig-what">
              <b>{x.title}</b>
              <span>{x.reason}</span>
            </span>
            <button className="btn sm" onClick={() => void startPromptThread(x.prompt, x.projectId)}>
              Start a thread on it
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
      )}
    </section>
  );
}
