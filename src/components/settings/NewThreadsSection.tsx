import { fallbackLabel, parseFallback, writeFallback, type Fallback } from "../../lib/fallback";
import { MODES, PICKER_MODES } from "../../lib/permissionMode";
import type { ThreadPrefs } from "../../lib/prefs";
import { useProviders } from "../../store/providers";
import { useUi } from "../../store/ui";
import type { SectionProps } from "./registry";

const CLAUDE_MODELS = [
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];
const EFFORTS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" },
];

/**
 * What a new thread starts with, as in T3's Settings → New threads: model and effort, a fallback
 * for when the account runs out (any provider), the permission mode and where it works.
 */
export function NewThreadsSection({ draft, update }: SectionProps) {
  const prefs = useUi((s) => s.prefs);
  const set = (patch: Partial<ThreadPrefs>) => useUi.getState().set({ prefs: { ...prefs, ...patch } });
  const opencode = useProviders((s) => s.list?.find((p) => p.id === "opencode"));
  const accounts = draft.accounts ?? [];
  const fb = parseFallback(prefs.fallback);
  const claudePicks: Fallback[] = accounts.flatMap((a) => CLAUDE_MODELS.map((m) => ({ provider: "claude" as const, account: a.name, model: m.value })));
  const openCodePicks: Fallback[] = opencode?.installed ? opencode.models.map((m) => ({ provider: "opencode" as const, model: m })) : [];
  const listed = [...claudePicks, ...openCodePicks].map(writeFallback);
  const mode = draft.claudePermissionMode && draft.claudePermissionMode !== "acceptEdits" ? draft.claudePermissionMode : "auto";

  return (
    <section className="set-group">
      <h3>New threads</h3>

      <label className="field">
        <span>Model</span>
        <select value={prefs.newModel} onChange={(e) => set({ newModel: e.target.value })} aria-label="Model for new threads">
          <option value="">Follow Auto effort settings</option>
          <option value="auto">Auto: picks per message</option>
          <option value="default">Claude Code's default</option>
          {CLAUDE_MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Effort</span>
        <select value={prefs.newEffort} onChange={(e) => set({ newEffort: e.target.value })} aria-label="Effort for new threads">
          <option value="">Follow Auto effort settings</option>
          <option value="auto">Auto: picks per message</option>
          <option value="default">Claude Code's default</option>
          {EFFORTS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">A thread's own picker on the composer still changes it for that thread.</p>

      <label className="field">
        <span>Fallback model</span>
        <select value={prefs.fallback} onChange={(e) => set({ fallback: e.target.value })} aria-label="Fallback model">
          <option value="">None: offer my other accounts</option>
          {claudePicks.length > 0 && (
            <optgroup label="Claude (the conversation moves with it)">
              {claudePicks.map((f) => (
                <option key={writeFallback(f)} value={writeFallback(f)}>
                  {fallbackLabel(f)}
                </option>
              ))}
            </optgroup>
          )}
          {openCodePicks.length > 0 && (
            <optgroup label="OpenCode (a new thread, seeded with the conversation)">
              {openCodePicks.map((f) => (
                <option key={writeFallback(f)} value={writeFallback(f)}>
                  {f.model}
                </option>
              ))}
            </optgroup>
          )}
          {/* A saved pick whose provider isn't listed right now still shows, so it isn't lost silently. */}
          {fb && !listed.includes(prefs.fallback) && (
            <option value={prefs.fallback}>{fallbackLabel(fb)} (not available now)</option>
          )}
        </select>
      </label>
      <p className="hint">
        When a thread's account hits its usage limit, the card that says so offers this first. Another Claude account keeps the
        conversation; another provider starts a new thread in the same folder with the recent conversation.
      </p>

      <label className="field">
        <span>Permissions</span>
        <div className="seg" role="radiogroup" aria-label="Permission mode for new threads">
          {PICKER_MODES.map((k) => (
            <button key={k} role="radio" aria-checked={mode === k} className={mode === k ? "on" : ""} title={MODES[k].what} onClick={() => update((c) => (c.claudePermissionMode = k))}>
              {MODES[k].label}
            </button>
          ))}
        </div>
      </label>
      <p className="hint">{MODES[mode]?.what}. Shift+Tab in a thread changes it for that thread.</p>

      <label className="field">
        <span>Workspace</span>
        <div className="seg" role="radiogroup" aria-label="Where new threads work">
          <button role="radio" aria-checked={!draft.worktreeByDefault} className={!draft.worktreeByDefault ? "on" : ""} onClick={() => update((c) => (c.worktreeByDefault = false))}>
            Local
          </button>
          <button role="radio" aria-checked={!!draft.worktreeByDefault} className={draft.worktreeByDefault ? "on" : ""} onClick={() => update((c) => (c.worktreeByDefault = true))}>
            New worktree
          </button>
        </div>
      </label>
      <p className="hint">
        New worktree gives each thread a branch and a folder under <code>&lt;repo&gt;.worktrees/</code>. The start screen still has a per-thread switch.
      </p>
    </section>
  );
}
