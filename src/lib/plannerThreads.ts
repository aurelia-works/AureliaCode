import { accountForFolder } from "./handoff";
import { expandPath } from "./format";
import { queueFirstMessage } from "./chat";
import { startDir } from "./launch";
import { cardPrompt, startCard } from "./plannerRoadmap";
import type { RoadmapCard } from "./planner";
import { useConfig } from "../store/config";
import { useGit } from "../store/git";
import { useLayout } from "../store/layout";
import { usePlanner } from "../store/planner";
import { toast, useUi } from "../store/ui";

/** Opens a Claude chat tab on a roadmap card, in its project's folder; the thread remembers the card id. */
export async function startCardThread(card: RoadmapCard) {
  const project = usePlanner.getState().data.projects.find((p) => p.id === card.project);
  const folder = project?.localRepoPath ? expandPath(project.localRepoPath) : useConfig.getState().config?.defaultWorkspace;
  const git = folder ? useGit.getState().info[folder] : undefined;
  const dir = await startDir(folder, useUi.getState().useWorktree && !!git, card.title.slice(0, 40));
  const id = useLayout.getState().newTab({ cwd: dir, mode: "chat", account: accountForFolder(folder) });
  useLayout.getState().updatePane(id, { cardId: card.id });
  queueFirstMessage(id, cardPrompt(card));
  usePlanner.getState().update((s) => startCard(s, card.id));
  useUi.getState().set({ roadmapOpen: false });
  toast(`Started a thread on "${card.title}"`);
}

/** A fresh chat tab on `prompt`, in the project's folder (or the default workspace). */
export async function startPromptThread(prompt: string, projectId: string | null) {
  const project = usePlanner.getState().data.projects.find((p) => p.id === projectId);
  const folder = project?.localRepoPath ? expandPath(project.localRepoPath) : useConfig.getState().config?.defaultWorkspace;
  const dir = await startDir(folder, false, prompt.slice(0, 40));
  const id = useLayout.getState().newTab({ cwd: dir, mode: "chat", account: accountForFolder(folder) });
  queueFirstMessage(id, prompt);
  useUi.getState().set({ mode: "terminals" });
}
