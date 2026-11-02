import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ipc, type Config } from "../../lib/ipc";
import { applyAppearance } from "../../lib/terminals";
import { useConfig } from "../../store/config";
import { useUi } from "../../store/ui";
import { applyUiAppearance } from "../../lib/uiAppearance";
import { CloseIcon, SearchIcon } from "../Icons";
import { SECTIONS } from "./registry";

/** Accounts commit on their own (see AccountsSection), so they never count as draft changes. */
const withoutAccounts = (c: Config) => JSON.stringify({ ...c, accounts: null });

export function SettingsPage() {
  const open = useUi((s) => s.settingsOpen);
  const config = useConfig((s) => s.config);
  const [draft, setDraft] = useState<Config | null>(null);
  const [sectionId, setSectionId] = useState(SECTIONS[0].id);
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && config) {
      setDraft(structuredClone(config));
      setMsg("");
      setQuery("");
      const want = useUi.getState().settingsSection;
      if (want) {
        setSectionId(want);
        useUi.getState().set({ settingsSection: null });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => useUi.getState().set({ settingsOpen: false });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (query) return setQuery("");
        close();
      }
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, query]);

  const dirty = useMemo(() => !!draft && !!config && withoutAccounts(draft) !== withoutAccounts(config), [draft, config]);
  const q = query.trim().toLowerCase();
  const shown = q ? SECTIONS.filter((s) => `${s.label} ${s.keywords}`.toLowerCase().includes(q)) : SECTIONS;

  if (!open || !draft) return null;
  const section = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0];
  const update = (fn: (c: Config) => void) => {
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
  };

  const save = async () => {
    try {
      // Accounts may have changed on their own since the draft was taken; always keep the live list.
      const live = useConfig.getState().config;
      const remoteChanged = JSON.stringify(live?.remote) !== JSON.stringify(draft.remote);
      await useConfig.getState().save({ ...draft, accounts: live?.accounts ?? draft.accounts });
      if (remoteChanged) await ipc.remoteApply();
      applyAppearance();
      applyUiAppearance();
      // Only a change to the default moves the switch: saving anything else keeps this thread's choice.
      if (!!config?.worktreeByDefault !== !!draft.worktreeByDefault) useUi.getState().set({ useWorktree: !!draft.worktreeByDefault });
      setMsg("Saved.");
    } catch (e) {
      setMsg(String(e));
    }
  };

  const discard = () => {
    if (config) setDraft(structuredClone(config));
    setMsg("");
  };

  return (
    <div className="settings-page" role="dialog" aria-label="Settings">
      <nav className="settings-nav">
        <h2>Settings</h2>
        <label className="settings-search">
          <SearchIcon width={13} height={13} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search settings"
            onChange={(e) => {
              const next = e.target.value;
              setQuery(next);
              const needle = next.trim().toLowerCase();
              const match = needle && SECTIONS.find((s) => `${s.label} ${s.keywords}`.toLowerCase().includes(needle));
              if (match) setSectionId(match.id);
            }}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            aria-label="Search settings"
          />
          {query ? (
            <button type="button" className="settings-search-clear" aria-label="Clear search" onClick={() => { setQuery(""); searchRef.current?.focus(); }}>
              ×
            </button>
          ) : (
            <kbd>/</kbd>
          )}
        </label>
        {shown.map((s, i) => {
          const showGroup = !q && (i === 0 || shown[i - 1].group !== s.group);
          return (
            <Fragment key={s.id}>
              {showGroup && <div className="settings-nav-group">{s.group}</div>}
              <button
                className={s.id === section.id ? "on" : ""}
                onClick={() => {
                  setSectionId(s.id);
                  if (q) setQuery("");
                }}
              >
                {s.label}
              </button>
            </Fragment>
          );
        })}
        {!shown.length && <p className="settings-nav-empty">No settings match “{query}”.</p>}
      </nav>
      <div className="settings-main">
        <div className="settings-head">
          <span className="settings-crumb">Settings</span>
          <span className="settings-sep">/</span>
          <b>{section.label}</b>
          <span className="settings-head-sp" />
          <button className="icon-btn sm" aria-label="Close settings" title="Close (Esc)" onClick={close}>
            <CloseIcon width={12} height={12} />
          </button>
        </div>
        <div className="settings-content">
          <section.Component draft={draft} update={update} notify={setMsg} />
        </div>
        <div className="settings-bar">
          <span className="msg">{msg || (dirty ? "Unsaved changes" : "")}</span>
          <button onClick={discard} disabled={!dirty}>
            Discard
          </button>
          <button className="primary" onClick={save} disabled={!dirty}>
            Save
          </button>
          <button onClick={close}>
            Close <kbd>Esc</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
