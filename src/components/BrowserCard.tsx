import { useEffect, useMemo, useState } from "react";
import { ipc } from "../lib/ipc";
import { parseBrowserAction } from "../lib/browserTool";
import { openInBrowserPane } from "../lib/browser";
import { useLayout } from "../store/layout";
import { ChevronIcon, GlobeIcon } from "./Icons";

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** One `aurelia_browser` call: what it did, the snapshot it read, the screenshot it took. */
export function BrowserCard({ name, input, result, isError, paneId }: { name: string; input: Record<string, unknown>; result?: string; isError?: boolean; paneId: string }) {
  const b = useMemo(() => parseBrowserAction(name, input, result, isError), [name, input, result, isError]);
  const [open, setOpen] = useState(false);
  const [shotFailed, setShotFailed] = useState(false);
  const [shot, setShot] = useState("");
  const paneExists = useLayout((s) => (b?.pane ? !!s.panes[b.pane] : false));
  useEffect(() => {
    let live = true;
    setShot("");
    setShotFailed(false);
    if (b?.image) {
      void ipc.readImage(b.image).then(
        (img) => live && !!img && setShot(`data:${img.mediaType};base64,${img.data}`),
        () => live && setShotFailed(true),
      );
    }
    return () => {
      live = false;
    };
  }, [b?.image]);
  if (!b) return null;
  const running = result === undefined;
  const src = shot;
  const openPane = () => {
    if (b.pane && paneExists) useLayout.getState().focusPane(b.pane);
    else openInBrowserPane(paneId, b.url ?? "");
  };
  return (
    <div className={`chat-browser${b.ok ? "" : " error"}${running ? " running" : ""}`}>
      <div className="chat-browser-head">
        <span className="chat-browser-logo" aria-hidden>
          <GlobeIcon width={13} height={13} />
        </span>
        <span className="chat-browser-action">{b.action}</span>
        <span className="chat-browser-sum" title={b.summary}>
          {b.summary}
        </span>
        {b.url && <span className="chat-browser-host num">{hostOf(b.url)}</span>}
      </div>
      {b.note && <p className="chat-browser-note">{b.note}</p>}
      {b.text && (
        <>
          <button type="button" className="link-btn chat-browser-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Hide snapshot" : "Show snapshot"}
            <ChevronIcon className="chat-chev" />
          </button>
          {open && <pre className="chat-browser-snapshot">{b.text}</pre>}
        </>
      )}
      {b.image && src && !shotFailed && (
        <figure className="chat-browser-shot">
          <img src={src} alt={b.target ? `Screenshot of ${b.target}` : "Browser screenshot"} onError={() => setShotFailed(true)} />
          <figcaption>
            {b.width && b.height ? `${b.width}×${b.height}` : "Screenshot"}
            {b.target ? ` · ${b.target}` : ""}
          </figcaption>
        </figure>
      )}
      {b.error && <p className="chat-browser-error">{b.error}</p>}
      {b.raw && !b.text && !b.error && <pre className="chat-browser-snapshot">{b.raw}</pre>}
      {(b.action === "open" || (!b.pane && b.url)) && (
        <div className="chat-browser-foot">
          <button type="button" className="link-btn" onClick={openPane}>
            Open browser pane
          </button>
        </div>
      )}
    </div>
  );
}
