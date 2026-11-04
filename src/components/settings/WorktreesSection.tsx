import type { SectionProps } from "./registry";

/** The one worktree default that changes behaviour before a thread starts. */
export function WorktreesSection({ draft, update }: SectionProps) {
  return (
    <section className="set-group">
      <h3>New threads</h3>
      <label className="field check">
        <input type="checkbox" checked={!!draft.worktreeByDefault} onChange={(e) => update((c) => (c.worktreeByDefault = e.target.checked))} />
        <span>Start new threads on their own git worktree by default</span>
      </label>
      <p className="hint">
        Each thread gets a branch and a sibling folder under <code>&lt;repo&gt;.worktrees/</code>. The start screen still has a
        per-thread switch, and cleanup skips a worktree with uncommitted changes.
      </p>
    </section>
  );
}
