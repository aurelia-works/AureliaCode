/**
 * Reading a state file (`ipc.loadState`). The Rust side returns null for a missing file and an error for one it
 * couldn't read. A store must never treat that error as "no file": it would start empty and its next save would
 * replace the real file. On `ok: false`, show the reason and don't save this session.
 */
export type Loaded<T> = { ok: true; value: T | null } | { ok: false; error: string };

export async function readSaved<T>(read: () => Promise<T | null>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
