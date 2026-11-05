/** Joins calls while a run is in flight; once it settles the next call runs again. `force` always starts a new run. */
export function singleFlight(fn: (force: boolean) => Promise<void>) {
  let pending: Promise<void> | null = null;
  return (force = false): Promise<void> => {
    if (pending && !force) return pending;
    const run: Promise<void> = fn(force).finally(() => {
      if (pending === run) pending = null;
    });
    pending = run;
    return run;
  };
}
