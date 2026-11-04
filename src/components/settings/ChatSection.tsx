import type { ThreadPrefs } from "../../lib/prefs";
import { useUi } from "../../store/ui";
import type { SectionProps } from "./registry";

/** Composer and message behaviour, matching T3's Chat settings. */
export function ChatSection({ draft, update }: SectionProps) {
  const prefs = useUi((s) => s.prefs);
  const set = (patch: Partial<ThreadPrefs>) => useUi.getState().set({ prefs: { ...prefs, ...patch } });
  const enterSends = draft.chatSendOnEnter !== false;
  return (
    <>
      <section className="set-group">
        <h3>Composer</h3>
        <label className="field">
          <span>Send with</span>
          <div className="seg">
            <button className={enterSends ? "on" : ""} onClick={() => update((c) => (c.chatSendOnEnter = true))}>
              Enter
            </button>
            <button className={!enterSends ? "on" : ""} onClick={() => update((c) => (c.chatSendOnEnter = false))}>
              ⌘Enter
            </button>
          </div>
        </label>
        <p className="hint">
          With ⌘Enter, Enter inserts a newline and ⌘Enter sends. Shift+Enter always inserts a newline.
        </p>
        <label className="field">
          <span>While Claude works, {enterSends ? "Enter" : "⌘Enter"}</span>
          <select value={prefs.followUp} onChange={(e) => set({ followUp: e.target.value as ThreadPrefs["followUp"] })}>
            <option value="queue">queues the message for after the turn</option>
            <option value="steer">stops the turn and sends now</option>
          </select>
        </label>
        <p className="hint">The opposite action is one key away with {enterSends ? "⌘Enter" : "⇧⌘Enter"}. Turn the feature off under Threads &amp; keys.</p>
      </section>

      <section className="set-group">
        <h3>Messages</h3>
        <label className="field check">
          <input type="checkbox" checked={!!draft.chatTimestamps} onChange={(e) => update((c) => (c.chatTimestamps = e.target.checked))} />
          <span>Show the time next to messages</span>
        </label>
        <p className="hint">Times appear on your messages and on each finished answer.</p>
      </section>
    </>
  );
}
