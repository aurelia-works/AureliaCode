import { Fragment, useEffect, useRef, useState } from "react";
import { ipc, type Config } from "../../lib/ipc";
import type { ThreadPrefs } from "../../lib/prefs";
import { foldMatches, resolveSectionId } from "../../lib/settingsIndex";
import { UndoStack, changedKeys } from "../../lib/settingsUndo";
import { applyAppearance } from "../../lib/terminals";
import { useConfig } from "../../store/config";
import { useUi } from "../../store/ui";
import { applyUiAppearance } from "../../lib/uiAppearance";
import { CloseIcon, SearchIcon } from "../Icons";
import { PART_COMPONENTS, SECTIONS, partLabel } from "./registry";

/** A change is written this long after the last edit, so typing a word is one save. */
const COMMIT_MS = 500;

/** Accounts commit on their own (see AccountsSection), so they are never part of a change or an undo step. */
const configKeys = (a: Config, b: Config) => changedKeys(a, b).filter((k) => k !== "accounts");
const noAccounts = (c: Config) => ({ ...c, accounts: null });

/** ⌘Z inside a text box stays the box's own undo. */
function isTextBox(el: EventTarget | null) {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return el instanceof HTMLInputElement && !["checkbox", "radio", "range", "button", "color"].includes(el.type);
}

const search = (q: string) => (q ? SECTIONS.filter((s) => s.text.includes(q)) : SECTIONS);

/**
 * Every row applies at once (config is written half a second after the last edit) and ⌘Z steps
 * back through config and prefs changes made while Settings is open. No Save or Discard.
 */
export function SettingsPage() {
  const open = useUi((s) => s.settingsOpen);
  const [draft, setDraft] = useState<Config | null>(null);
  const [sectionId, setSectionId] = useState(SECTIONS[0].id);
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  /** What config.json holds now, and what the rows show (it runs ahead while a write waits). */
  const saved = useRef<Config | null>(null);
  const live = useRef<Config | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const undo = useRef(new UndoStack());
  const restoring = useRef(false);

  const show = (c: Config) => {
    live.current = c;
    setDraft(c);
  };

  const commit = async (done = "Saved · ⌘Z undoes") => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const prev = saved.current;
    const next = live.current;
    if (!prev || !next) return;
    const keys = configKeys(prev, next);
    if (!keys.length) return;
    // Only the fields changed here go on top of what's on disk, so a row that saves on its own
    // (accounts, the proxy hub, a palette) is never written over with an older value.
    const base = useConfig.getState().config ?? prev;
    const merged = { ...base } as Record<string, unknown>;
    for (const k of keys) merged[k] = (next as unknown as Record<string, unknown>)[k];
    try {
      await useConfig.getState().save(merged as unknown as Config);
      if (keys.includes("remote")) await ipc.remoteApply();
      applyAppearance();
      applyUiAppearance();
      // Only a change to the default moves the switch: anything else keeps this thread's choice.
      if (keys.includes("worktreeByDefault")) useUi.getState().set({ useWorktree: !!next.worktreeByDefault });
      setMsg(done);
    } catch (e) {
      setMsg(String(e));
    }
  };

  useEffect(() => {
    if (!open) return;
    const config = useConfig.getState().config;
    if (config) {
      saved.current = config;
      show(structuredClone(config));
    }
    undo.current.clear();
    setMsg("");
    setQuery("");
    const want = useUi.getState().settingsSection;
    if (want) {
      setSectionId(resolveSectionId(want));
      useUi.getState().set({ settingsSection: null });
    }
    // config.json changed (a write from here, or a row that saves on its own): keep edits still waiting.
    const offConfig = useConfig.subscribe((s, p) => {
      if (!s.config || s.config === p.config) return;
      const waiting = saved.current && live.current ? configKeys(saved.current, live.current) : [];
      const next = structuredClone(s.config) as unknown as Record<string, unknown>;
      for (const k of waiting) next[k] = (live.current as unknown as Record<string, unknown>)[k];
      saved.current = s.config;
      show(next as unknown as Config);
    });
    // Prefs apply at once wherever they're set; record each for ⌘Z.
    const offPrefs = useUi.subscribe((s, p) => {
      if (s.prefs !== p.prefs && !restoring.current) undo.current.push("prefs", p.prefs, s.prefs, Date.now());
    });
    return () => {
      offConfig();
      offPrefs();
      void commit();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = (fn: (c: Config) => void) => {
    const before = live.current;
    if (!before) return;
    const next = structuredClone(before);
    fn(next);
    undo.current.push("config", noAccounts(before), noAccounts(next), Date.now());
    show(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void commit(), COMMIT_MS);
  };

  const undoLast = () => {
    const step = undo.current.undo();
    if (!step) return setMsg("Nothing to undo");
    const keys = step.key.split(",");
    const before = step.before as Record<string, unknown>;
    if (step.kind === "config" && live.current) {
      const next = { ...live.current } as unknown as Record<string, unknown>;
      for (const k of keys) next[k] = before[k];
      show(next as unknown as Config);
      void commit("Undone");
    } else if (step.kind === "prefs") {
      const prefs = { ...useUi.getState().prefs } as unknown as Record<string, unknown>;
      for (const k of keys) prefs[k] = before[k];
      restoring.current = true;
      useUi.getState().set({ prefs: prefs as unknown as ThreadPrefs });
      restoring.current = false;
    }
    setMsg("Undone");
  };

  const close = () => useUi.getState().set({ settingsOpen: false });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (query) return setQuery("");
        close();
      }
      if (e.code === "KeyZ" && e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && !isTextBox(e.target)) {
        e.preventDefault();
        undoLast();
        return;
      }
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTextBox(e.target)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query]);

  const q = query.trim().toLowerCase();
  const shown = search(q);

  if (!open || !draft) return null;
  const section = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0];
  const props = { draft, update, notify: setMsg };

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
              const match = needle && search(needle)[0];
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
          <span className="settings-status" role="status">{msg}</span>
          <button className="icon-btn sm" aria-label="Close settings" title="Close (Esc)" onClick={close}>
            <CloseIcon width={12} height={12} />
          </button>
        </div>
        <div className="settings-content">
          {section.parts.map((p) => {
            const Part = PART_COMPONENTS[p];
            return <Part key={p} {...props} />;
          })}
          {section.folded && (
            <details className="set-fold" key={`${section.id}:${foldMatches(section, q)}`} open={foldMatches(section, q) || undefined}>
              <summary>
                <span>Advanced</span>
                <span className="hint inline">{section.folded.map(partLabel).join(" · ")}</span>
              </summary>
              {section.folded.map((p) => {
                const Part = PART_COMPONENTS[p];
                return <Part key={p} {...props} />;
              })}
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
