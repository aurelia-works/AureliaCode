import { useEffect, useState } from "react";
import { DEFAULT_SKILL_ROOTS, sortSkills } from "../../lib/skills";
import { useSkills } from "../../store/skills";
import type { SectionProps } from "./registry";

/** Settings → Skills: where the DeepSeek pack is read from, and what was found. */
export function SkillsSection(_props: SectionProps) {
  const roots = useSkills((s) => s.roots);
  const skills = useSkills((s) => s.skills);
  const loading = useSkills((s) => s.loading);
  const error = useSkills((s) => s.error);
  const [path, setPath] = useState("");

  useEffect(() => {
    if (!skills.length) void useSkills.getState().load();
  }, [skills.length]);

  return (
    <>
      <section className="set-group">
        <h3>DeepSeek skills</h3>
        <p className="hint">
          Read from these folders, in order. The first skill with a name wins. The home route shows the pack; ds-swarm is pinned first.
        </p>
        <ul className="acct-list">
          {roots.map((r) => (
            <li key={r.path}>
              <div className="acct-row">
                <span className="my-agent-name">{r.label}</span>
                <code>{r.path}</code>
                <span className="acct-actions">
                  <button className="link-btn" onClick={() => void useSkills.getState().setRoots(roots.filter((x) => x.path !== r.path))}>
                    Remove
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
        <div className="field-row">
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="Add a skill folder (~/… or /…)" aria-label="Skill folder" />
          <button
            type="button"
            disabled={!path.trim()}
            onClick={() => {
              const p = path.trim();
              if (!p) return;
              setPath("");
              void useSkills.getState().setRoots([...roots, { path: p, label: p.split("/").filter(Boolean).pop() || "Skills" }]);
            }}
          >
            Add folder
          </button>
          <button type="button" onClick={() => void useSkills.getState().refresh()} disabled={loading}>
            {loading ? "Scanning…" : "Rescan"}
          </button>
          <button type="button" onClick={() => void useSkills.getState().setRoots(DEFAULT_SKILL_ROOTS)}>
            Reset defaults
          </button>
        </div>
        {error && <p className="hint err">{error}</p>}
        <p className="hint">
          {loading ? "Scanning…" : `${skills.length} skills found`}
          {skills.length > 0 && ` · ${sortSkills(skills).slice(0, 3).map((s) => s.name).join(", ")}…`}
        </p>
      </section>
    </>
  );
}
