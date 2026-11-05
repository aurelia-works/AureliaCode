import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { greetingFor, msUntilNextHour } from "../lib/greeting";
import { useUi } from "../store/ui";

/** How long the letters take to swap, stagger included (deep.css `.wm`). */
const MORPH_MS = 900;

const reducedMotion = () =>
  document.documentElement.dataset.motion === "reduced" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** One letter per span, so each can blur out or in a beat after the one before it. */
function Letters({ text, dimFrom }: { text: string; dimFrom?: number }) {
  return [...text].map((ch, i) => (
    <span key={i} className={dimFrom !== undefined && i >= dimFrom ? "wm-ch dim" : "wm-ch"} style={{ "--i": i } as React.CSSProperties}>
      {ch === " " ? " " : ch}
    </span>
  ));
}

/**
 * The title-bar wordmark: "AureliaCode" in Instrument Serif italic. On the hour it morphs into
 * "Morning, Jah", holds, then morphs back (Settings → Appearance → Wordmark). With reduce motion
 * it swaps without the morph. One timeout per hour; nothing ticks in between.
 */
export function Wordmark() {
  const on = useUi((s) => s.prefs.greeting);
  const holdS = useUi((s) => s.prefs.greetingHoldS);
  const name = useUi((s) => s.prefs.greetingName);
  const playAt = useUi((s) => s.greetingPlayAt);
  const [greeting, setGreeting] = useState<string | null>(null);
  const brandRef = useRef<HTMLSpanElement>(null);
  const greetRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();
  const hold = useRef<ReturnType<typeof setTimeout>>(undefined);

  const play = () => {
    clearTimeout(hold.current);
    setGreeting(greetingFor(new Date().getHours(), useUi.getState().prefs.greetingName));
    hold.current = setTimeout(() => setGreeting(null), useUi.getState().prefs.greetingHoldS * 1000 + (reducedMotion() ? 0 : MORPH_MS));
  };

  // Arm a timeout for the next top of the hour, then the one after.
  useEffect(() => {
    if (!on) return setGreeting(null);
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      t = setTimeout(() => {
        play();
        arm();
      }, msUntilNextHour(new Date()) + 50);
    };
    arm();
    return () => clearTimeout(t);
  }, [on]);

  // "Play it now" in Settings.
  useEffect(() => {
    if (playAt) play();
  }, [playAt]);

  useEffect(() => () => clearTimeout(hold.current), []);

  // The box eases between the two words' widths instead of jumping.
  useLayoutEffect(() => {
    const el = greeting ? greetRef.current : brandRef.current;
    if (el) setWidth(el.scrollWidth);
  }, [greeting, name, holdS]);

  return (
    <span className="brand-name wm" data-show={greeting ? "greeting" : "brand"} style={{ width }} aria-label={greeting ?? "AureliaCode"} data-tauri-drag-region>
      <span ref={brandRef} className="wm-layer wm-brand" aria-hidden>
        <Letters text="AureliaCode" dimFrom={7} />
      </span>
      <span ref={greetRef} className="wm-layer wm-greet" aria-hidden>
        <Letters text={greeting ?? greetingFor(new Date().getHours(), name)} />
      </span>
    </span>
  );
}
