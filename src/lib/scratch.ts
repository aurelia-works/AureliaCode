import { ipc } from "./ipc";
import { scratchName } from "./scratchName";
import { useLayout } from "../store/layout";

/** A new empty folder for a project-less thread; the files the agent writes stay after the thread is gone. */
export async function newScratchDir(): Promise<string> {
  return ipc.makeScratch(scratchName(new Date(), Math.random().toString(36).slice(2, 8)));
}

/** A new start tab inside a fresh scratch folder. */
export async function newScratchTab() {
  useLayout.getState().newTab({ cwd: await newScratchDir(), launcher: true });
}
