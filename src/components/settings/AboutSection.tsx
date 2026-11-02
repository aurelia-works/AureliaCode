import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { ipc } from "../../lib/ipc";
import type { SectionProps } from "./registry";

export function AboutSection(_: SectionProps) {
  const [version, setVersion] = useState("dev");
  useEffect(() => {
    void getVersion().then((v) => setVersion(v || "dev"), () => {});
  }, []);
  const open = (url: string) => void ipc.openUrl(url).catch(() => {});
  return (
    <>
      <section className="set-group">
        <h3>AureliaSpace {version}</h3>
        <p className="hint">
          A local-first workspace for many coding agents: terminals, chats, review and a thread list that keeps the work in
          one place.
        </p>
        <div className="field-row">
          <button type="button" onClick={() => open("https://github.com/aurelia-works/AureliaSpace")}>
            GitHub
          </button>
          <button type="button" onClick={() => open("https://github.com/aurelia-works/AureliaSpace/releases")}>
            Releases
          </button>
          <button type="button" onClick={() => open("https://github.com/aurelia-works/AureliaSpace/issues")}>
            Report an issue
          </button>
        </div>
      </section>
    </>
  );
}
