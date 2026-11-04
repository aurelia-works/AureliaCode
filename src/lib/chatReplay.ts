import { addUser, type Transcript } from "./chatModel.ts";

export interface QueuedMsg {
  text: string;
  images?: string[];
  uuid: string;
}

/**
 * With `--replay-user-messages` the CLI echoes each message it takes from stdin. A message sent
 * while Claude works is usually taken inside the running turn, so the echo, not the next turnEnd,
 * is when it leaves the queue. Returns null for lines that aren't such an echo.
 */
export function takeReplay(transcript: Transcript, queued: QueuedMsg[], msg: Record<string, unknown>): { transcript: Transcript; queued: QueuedMsg[] } | null {
  if (msg.type !== "user" || msg.isReplay !== true || typeof msg.uuid !== "string") return null;
  const uuid = msg.uuid;
  const q = queued.find((m) => m.uuid === uuid);
  if (q) return { transcript: addUser(transcript, q.text, Date.now(), { images: q.images, uuid }), queued: queued.filter((m) => m !== q) };
  if (transcript.items.some((i) => i.kind === "user" && i.uuid === uuid)) return { transcript, queued };
  return null;
}
