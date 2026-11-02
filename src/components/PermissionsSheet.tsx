import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";
import { toast, useUi } from "../store/ui";
import { AureliaMark } from "./Icons";

/**
 * Grants macOS won't prompt for: open the System Settings list, then drag the app into it.
 * The status re-checks every 2 s, so it turns green once the grant lands.
 */
export function PermissionsSheet() {
  const close = () => useUi.getState().set({ permissionsOpen: false });
  const [bundle, setBundle] = useState<string | null>(null);
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    void ipc.appBundlePath().then(setBundle, () => setBundle(null));
  }, []);
  useEffect(() => {
    let live = true;
    const check = () => void ipc.hasFullDiskAccess().then((g) => live && setGranted(g), () => {});
    check();
    const t = setInterval(check, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const drag = (e: React.MouseEvent) => {
    if (!bundle || e.button !== 0) return;
    e.preventDefault();
    startDrag({ item: [bundle], icon: `${bundle}/Contents/Resources/icon.icns` }).catch((err) => toast(`Couldn't start the drag: ${err}`, true));
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal perm-sheet" role="dialog" aria-label="Permissions" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && close()}>
        <div className="modal-head">
          <h2>Permissions</h2>
          <button type="button" className="icon-btn" title="Close" onClick={close}>
            ×
          </button>
        </div>
        <section className="perm-row">
          <div className="perm-text">
            <h3>
              Full Disk Access
              <span className={`perm-state${granted ? " ok" : ""}`}>{granted === null ? "Checking…" : granted ? "Granted" : "Not yet"}</span>
            </h3>
            <p className="hint">Stops the macOS popups each time an agent touches Downloads, Documents or another app's data.</p>
            <ol className="perm-steps">
              <li>
                <button type="button" className="perm-open" onClick={() => void ipc.openFullDiskAccessSettings()}>
                  Open Full Disk Access
                </button>
              </li>
              <li>Drag AureliaCode into the list and turn it on.</li>
              <li>Reopen AureliaCode.</li>
            </ol>
          </div>
          <div
            className={`perm-drag${bundle ? "" : " off"}`}
            onMouseDown={drag}
            role="button"
            aria-label="Drag AureliaCode into System Settings"
            title={bundle ? "Drag me into the Full Disk Access list" : "Only the installed app can be dragged"}
          >
            <AureliaMark width={44} height={44} />
            <span>AureliaCode</span>
            <small>{bundle ? "drag me" : "installed app only"}</small>
          </div>
        </section>
      </div>
    </div>
  );
}
