import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { singleFlight } from "../lib/singleFlight";
import type { ProviderStatus } from "../lib/providers";

/** The agent CLIs on this Mac (src-tauri/src/providers.rs), loaded once and on Refresh. */
export const useProviders = create<{ list?: ProviderStatus[]; loading: boolean; error?: string }>(() => ({ loading: false }));

const load = singleFlight((refresh) => {
  useProviders.setState({ loading: true, error: undefined });
  return ipc.providers(refresh).then(
    (list) => useProviders.setState({ list, loading: false }),
    (e) => useProviders.setState({ loading: false, error: String(e) }),
  );
});

/** Loads the list (the Rust side caches it); `refresh` runs every CLI's status command again. Calls while a load is
 * running join it; after it settles (even after a failure) the next call loads again. */
export function loadProviders(refresh = false): Promise<void> {
  return load(refresh);
}
