import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openInBrowserPane } from "../lib/browser";
import { ipc } from "../lib/ipc";
import { frameHeight, THEME_VARS, visualSrcdoc, type VisualReply } from "../lib/visualReply";
import { CollapseIcon, ExpandIcon, GlobeIcon } from "./Icons";

function themeNow() {
  const root = document.documentElement;
  const css = getComputedStyle(root);
  const vars: Record<string, string> = {};
  for (const k of THEME_VARS) {
    const v = css.getPropertyValue(k).trim();
    if (v) vars[k] = v;
  }
  const scheme: "dark" | "light" = root.dataset.theme === "light" ? "light" : "dark";
  return { vars, scheme };
}

/** The page's iframe: scripts only, an opaque origin, nothing of the app's reachable. */
function Frame({ srcdoc, title, fill }: { srcdoc: string; title: string; fill?: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(frameHeight(0));
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow || !e.data?.aureliaVisual) return;
      if (typeof e.data.height === "number") setHeight(frameHeight(e.data.height));
      if (typeof e.data.open === "string" && /^https?:\/\//i.test(e.data.open)) void ipc.openUrl(e.data.open);
    };
    window.addEventListener("message", onMessage);
    // Follow the app's theme as it changes, without reloading the page.
    const watch = new MutationObserver(() => {
      const { vars, scheme } = themeNow();
      ref.current?.contentWindow?.postMessage({ aureliaTheme: vars, scheme }, "*");
    });
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme", "data-contrast"] });
    return () => {
      window.removeEventListener("message", onMessage);
      watch.disconnect();
    };
  }, []);
  return <iframe ref={ref} className="chat-visual-frame" sandbox="allow-scripts" srcDoc={srcdoc} title={title} style={fill ? undefined : { height }} />;
}

/** A page an agent showed with aurelia_show_html, as a card in the thread: expand, or open in a browser pane. */
export function VisualReplyCard({ visual, paneId }: { visual: VisualReply; paneId: string }) {
  const [full, setFull] = useState(false);
  const srcdoc = useMemo(() => {
    const { vars, scheme } = themeNow();
    return visualSrcdoc(visual.html, vars, scheme);
  }, [visual.html]);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
  const actions = (
    <>
      {visual.url && (
        <button type="button" className="icon-btn" title="Open in a browser pane" aria-label="Open in a browser pane" onClick={() => openInBrowserPane(paneId, visual.url!)}>
          <GlobeIcon />
        </button>
      )}
      <button type="button" className="icon-btn" title={full ? "Back to the thread (Esc)" : "Expand"} aria-label={full ? "Back to the thread" : "Expand"} onClick={() => setFull((f) => !f)}>
        {full ? <CollapseIcon /> : <ExpandIcon />}
      </button>
    </>
  );
  return (
    <figure className="chat-visual">
      <figcaption className="chat-visual-head">
        <span className="chat-visual-title">{visual.title}</span>
        {actions}
      </figcaption>
      {!full && <Frame srcdoc={srcdoc} title={visual.title} />}
      {full &&
        createPortal(
          <div className="modal-backdrop chat-visual-backdrop" onMouseDown={() => setFull(false)}>
            <div className="chat-visual-full" role="dialog" aria-label={visual.title} onMouseDown={(e) => e.stopPropagation()}>
              <div className="chat-visual-head">
                <span className="chat-visual-title">{visual.title}</span>
                {actions}
              </div>
              <Frame srcdoc={srcdoc} title={visual.title} fill />
            </div>
          </div>,
          document.body,
        )}
    </figure>
  );
}
