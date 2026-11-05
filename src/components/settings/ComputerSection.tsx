import { useEffect, useState } from "react";
import { ipc } from "../../lib/ipc";
import { useUi } from "../../store/ui";

interface Status {
  platform: string;
  accessibility: boolean;
  screenRecording: boolean;
  secureInput: boolean;
  screen: { w: number; h: number } | null;
}

interface Shot {
  image: string;
  width: number;
  height: number;
}

function Yes({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className={ok ? "ok" : "bad"}>
      <span className="computer-dot" aria-hidden />
      {children}
      <span className="computer-yes">{ok ? "Allowed" : "Off"}</span>
    </li>
  );
}

/**
 * Desktop computer use is not the built-in browser: it drives any macOS app with screen
 * coordinates and synthetic input. It is off by default and needs two macOS permissions.
 */
export function ComputerSection() {
  const on = useUi((s) => s.prefs.computerUse);
  const [status, setStatus] = useState<Status | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [shotSrc, setShotSrc] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    setError("");
    void ipc.computerStatus().then(setStatus, (e) => setError(String(e)));
  };

  useEffect(() => {
    if (on) refresh();
  }, [on]);

  useEffect(() => {
    if (!shot) return;
    let live = true;
    setShotSrc("");
    void ipc.readImage(shot.image).then(
      (img) => live && !!img && setShotSrc(`data:${img.mediaType};base64,${img.data}`),
      () => live && setShotSrc(""),
    );
    return () => {
      live = false;
    };
  }, [shot]);

  const test = async () => {
    setBusy(true);
    setError("");
    try {
      setShot(await ipc.computerScreenshot());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="set-group">
      <h3>Computer use</h3>
      <label className="field check">
        <input type="checkbox" checked={on} onChange={(e) => useUi.getState().set({ prefs: { ...useUi.getState().prefs, computerUse: e.target.checked } })} />
        <span>Let an agent control the desktop</span>
      </label>
      <p className="hint">
        Off by default. This is separate from the browser pane: it can take a screenshot, move the mouse, click and type in
        any macOS app. For web pages, agents use <code>aurelia_browser</code> and its DOM snapshots instead.
      </p>
      {on && (
        <>
          {!status && <p className="hint">{error || "Checking macOS permissions…"}</p>}
          {status && (
            <ul className="computer-status">
              <Yes ok={status.accessibility}>Accessibility (mouse and keyboard)</Yes>
              <Yes ok={status.screenRecording}>Screen Recording (screenshots)</Yes>
              <Yes ok={!status.secureInput}>Secure input is off (password fields)</Yes>
            </ul>
          )}
          {status && (!status.accessibility || !status.screenRecording) && (
            <p className="hint">
              <button type="button" className="link-btn" onClick={() => void ipc.computerOpenSettings("accessibility")}>
                Open Accessibility
              </button>
              {" · "}
              <button type="button" className="link-btn" onClick={() => void ipc.computerOpenSettings("screen")}>
                Open Screen Recording
              </button>
              {" · "}
              <button type="button" className="link-btn" onClick={refresh}>
                Check again
              </button>
              . macOS applies a new permission after AureliaCode restarts.
            </p>
          )}
          <p className="hint">
            <button type="button" className="btn sm" disabled={busy || !!status?.secureInput} onClick={() => void test()}>
              {busy ? "Taking…" : "Take a test screenshot"}
            </button>{" "}
            {status?.screen ? `Main screen ${status.screen.w}×${status.screen.h} points` : ""}
          </p>
          {error && <p className="hint bad-text">{error}</p>}
          {shot && shotSrc && (
            <figure className="computer-shot">
              <img src={shotSrc} alt="Desktop test screenshot" onError={() => setShot(null)} />
              <figcaption>
                {shot.width}×{shot.height} · {shot.image}
              </figcaption>
            </figure>
          )}
          <p className="hint">
            Every action is written to <code>computer-audit.jsonl</code> in the app folder. Quit and force-quit key
            combinations are blocked, and typing is refused while secure input is active.
          </p>
        </>
      )}
    </section>
  );
}
