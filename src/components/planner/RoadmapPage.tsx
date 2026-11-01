import { useEffect, useState } from "react";
import type { RoadmapCard, RoadmapLane } from "../../lib/planner";
import { addCard, editCard, LANES, lanesFor, moveCard, removeCard } from "../../lib/plannerRoadmap";
import { startCardThread } from "../../lib/plannerThreads";
import { localDate } from "../../lib/plannerToday";
import { usePlanner } from "../../store/planner";
import { useUi } from "../../store/ui";

/** Full-screen roadmap: four lanes per project, drag a card between lanes, open one to edit or start a thread. */
export function RoadmapPage() {
  const open = useUi((s) => s.roadmapOpen);
  const project = useUi((s) => s.roadmapProject);
  const data = usePlanner((s) => s.data);
  const [title, setTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const up = usePlanner.getState().update;
  const close = () => useUi.getState().set({ roadmapOpen: false });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const projects = data.projects.filter((p) => !p.archivedAt);
  const lanes = lanesFor(data, project);
  const todayGoals = data.dailyGoalsByDate[localDate()]?.goals ?? [];
  const drop = (lane: RoadmapLane, e: React.DragEvent) => {
    const id = e.dataTransfer.getData("text/plain");
    if (id) up((s) => moveCard(s, id, lane));
  };

  return (
    <div className="roadmap-page" role="dialog" aria-label="Roadmap">
      <header className="roadmap-head">
        <h2>Roadmap</h2>
        <select value={project ?? ""} onChange={(e) => useUi.getState().set({ roadmapProject: e.target.value || null })} aria-label="Project">
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <form
          className="roadmap-add"
          onSubmit={(e) => {
            e.preventDefault();
            up((s) => addCard(s, project, title));
            setTitle("");
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a card to Next" aria-label="Add a card" />
        </form>
        <span className="chat-card-gap" />
        <button className="today-btn" onClick={close}>
          Close <kbd>Esc</kbd>
        </button>
      </header>
      <div className="roadmap-lanes">
        {LANES.map((l) => (
          <section key={l.id} className="rlane" onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(l.id, e)} aria-label={l.label}>
            <h3>
              {l.label} <span>{lanes[l.id].length}</span>
            </h3>
            {lanes[l.id].map((c) => (
              <Card key={c.id} card={c} lane={l.id} open={openId === c.id} onOpen={() => setOpenId(openId === c.id ? null : c.id)} goals={todayGoals} projectName={project === null ? projects.find((p) => p.id === c.project)?.name : undefined} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function Card({ card, lane, open, onOpen, goals, projectName }: { card: RoadmapCard; lane: RoadmapLane; open: boolean; onOpen(): void; goals: { id: string; title: string }[]; projectName?: string }) {
  const up = usePlanner.getState().update;
  const i = LANES.findIndex((l) => l.id === lane);
  return (
    <article className="rcard" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", card.id)}>
      <button className="rcard-title" onClick={onOpen} aria-expanded={open}>
        {card.title}
      </button>
      {projectName && <span className="rcard-meta">{projectName}</span>}
      {card.dueDate && <span className="rcard-meta">due {card.dueDate}</span>}
      {open && (
        <div className="rcard-detail">
          <input value={card.title} onChange={(e) => up((s) => editCard(s, card.id, { title: e.target.value }))} aria-label="Title" />
          <textarea rows={3} value={card.description} onChange={(e) => up((s) => editCard(s, card.id, { description: e.target.value }))} placeholder="Description (sent as the thread's first message)" aria-label="Description" />
          <label className="rcard-row">
            Due
            <input type="date" value={card.dueDate ?? ""} onChange={(e) => up((s) => editCard(s, card.id, { dueDate: e.target.value || null }))} />
          </label>
          <label className="rcard-row">
            Ticks goal
            <select value={card.goalId ?? ""} onChange={(e) => up((s) => editCard(s, card.id, { goalId: e.target.value || null }))}>
              <option value="">none</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="rcard-bar">
        <button className="icon-btn sm" disabled={i === 0} aria-label="Move left" onClick={() => up((s) => moveCard(s, card.id, LANES[i - 1].id))}>←</button>
        <button className="icon-btn sm" disabled={i === LANES.length - 1} aria-label="Move right" onClick={() => up((s) => moveCard(s, card.id, LANES[i + 1].id))}>→</button>
        {lane !== "shipped" && (
          <button className="today-btn sm" onClick={() => void startCardThread(card)}>
            Start thread
          </button>
        )}
        <span className="chat-card-gap" />
        <button className="icon-btn sm" aria-label="Delete card" onClick={() => up((s) => removeCard(s, card.id))}>×</button>
      </div>
    </article>
  );
}
