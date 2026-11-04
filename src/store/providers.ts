import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { ProviderStatus } from "../lib/providers";

/** The agent CLIs on this Mac (src-tauri/src/providers.rs), loaded once and on Refresh. */
export const useProviders = create<{ list?: ProviderStatus[]; loading: boolean; error?: string }>(() => ({ loading: false }));

let pending: Promise<void> | null = null;

/** Loads the list (the Rust side caches it); `refresh` runs every CLI's status command again. */
export function loadProviders(refresh = false): Promise<void> {
  if (pending && !refresh) return pending;
  useProviders.setState({ loading: true, error: undefined });
  const run = ipc.providers(refresh).then(
    (list) => useProviders.setState({ list, loading: false }),
    (e) => useProviders.setState({ loading: false, error: String(e) }),
  );
  pending = run.finally(() => {
    if (pending === run) pending = null;
  });
  return run;
}
