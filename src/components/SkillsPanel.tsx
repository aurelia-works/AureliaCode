import { useEffect, useMemo, useState } from "react";
import { filterSkills, skillLabel, type Skill } from "../lib/skills";
import { useSkills } from "../store/skills";
import { ArrowIcon, SparkIcon } from "./Icons";

/**
 * The DeepSeek skill pack on the home route. ds-swarm sits first: one click turns the
 * composer's task into a fan-out run. The rest of the pack is one search away.
 */
export function SkillsPanel({ task, onRun }: { task: string; onRun(skill: Skill, task: string): void }) {
  const skills = useSkills((s) => s.skills);
  const loading = useSkills((s) => s.loading);
  const error = useSkills((s) => s.error);
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string>("ds-swarm");

  useEffect(() => {
    if (!skills.length) void useSkills.getState().load();
  }, [skills.length]);

  const filtered = useMemo(() => filterSkills(skills, query), [skills, query]);
  const shown = all || query ? filtered : filtered.slice(0, 8);
  const selected = filtered.find((s) => s.name === picked) ?? filtered[0];
  const canRun = !!selected && !!task.trim();

  return (
    <section className="start-skills" aria-label="DeepSeek skills">
      <div className="start-skills-head">
        <h2>
          <SparkIcon width={13} height={13} /> DeepSeek skills
        </h2>
        <span className="start-skills-sub">
          {loading ? "Reading your skill folders…" : error ? error : `${skills.length} installed`}
        </span>
        <button type="button" className="link-btn" onClick={() => void useSkills.getState().refresh()} title="Rescan the skill folders">
          Refresh
        </button>
      </div>
      <div className="start-skills-search">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a skill…" spellCheck={false} aria-label="Find a skill" />
        <button type="button" className="start-skills-all" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `All ${skills.length}`}
        </button>
      </div>
      <div className="start-skills-grid" role="list">
        {shown.map((s) => (
          <button
            key={s.name}
            type="button"
            role="listitem"
            className={`start-skill${s.name === selected?.name ? " on" : ""}${s.name === "ds-swarm" ? " swarm" : ""}`}
            title={`${s.description}\n${s.path}`}
            onClick={() => setPicked(s.name)}
          >
            <span className="start-skill-name">{skillLabel(s)}</span>
            {s.name === "ds-swarm" && <span className="start-skill-tag">swarm</span>}
          </button>
        ))}
        {!shown.length && !loading && <span className="start-skills-empty">No skill matches “{query}”.</span>}
      </div>
      {selected && (
        <div className="start-skills-run">
          <span className="start-skills-desc" title={selected.description}>
            <b>{selected.name}</b> · {selected.description || "No description"}
          </span>
          <button
            type="button"
            className="start-skills-go"
            disabled={!canRun}
            title={canRun ? `Run ${selected.name} on this task` : "Describe the task in the composer first"}
            onClick={() => canRun && onRun(selected, task)}
          >
            Run {selected.name === "ds-swarm" ? "swarm" : "skill"}
            <ArrowIcon width={12} height={12} />
          </button>
        </div>
      )}
    </section>
  );
}
