import { invoke } from "@tauri-apps/api/core";

/** Durable history in `aurelia.db` (src-tauri/src/store.rs). Live state stays in Zustand. */
export interface StoredThread {
  id: string;
  title?: string;
  project?: string | null;
  cwd?: string | null;
  harness?: string | null;
  sessionId?: string | null;
  status?: string;
  snapshot?: unknown;
  createdAt?: number;
  updatedAt?: number;
}

export interface StoredEvent {
  id: number;
  kind: string;
  payload?: unknown;
  at: number;
}

export const db = {
  upsertThread: (thread: StoredThread) => invoke<void>("store_thread_upsert", { thread }),
  threads: (limit = 200) => invoke<StoredThread[]>("store_threads", { limit }),
  deleteThread: (id: string) => invoke<void>("store_thread_delete", { id }),
  search: (query: string, limit = 50) => invoke<StoredThread[]>("store_thread_search", { query, limit }),
  appendEvent: (threadId: string, kind: string, payload?: unknown) => invoke<void>("store_event_append", { threadId, kind, payload }),
  events: (threadId: string, limit = 200) => invoke<StoredEvent[]>("store_events", { threadId, limit }),
  importThreads: (threads: StoredThread[]) => invoke<number>("store_import_threads", { threads }),
  health: () => invoke<{ ok: boolean; threads: number; events: number; path: string }>("store_health"),
};
