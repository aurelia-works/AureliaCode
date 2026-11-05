import { queueFirstMessage } from "../lib/chat";
import { basename } from "../lib/format";
import { useLayout } from "../store/layout";
import { dismissFinding, runNightly, useNightly } from "../store/nightly";
import { useUi } from "../store/ui";

/** What last night's review of old code found (store/nightly.ts): only important findings two reviewers agree on. */
export function OvernightCard() {
  const on = useUi((s) => s.prefs.nightlyReview);
  const byRepo = useNightly((s) => s.byRepo);
  const dismissed = useNightly((s) => s.dismissed);
  const running = useNightly((s) => s.running);
  if (!on) return null;
  const rows = Object.entries(byRepo).flatMap(([repo, n]) =>
    n.findings.map((f) => ({ repo, n, f, key: `${repo}|${f.file ?? ""}:${f.line ?? ""}|${f.text}` })).filter((r) => !dismissed.includes(r.key)),
  );
  const errors = Object.entries(byRepo).filter(([, n]) => n.error);
  if (!rows.length && !errors.length && !running) return null;
  const fix = (repo: string, where: string, text: string) => {
    const id = useLayout.getState().newTab({ mode: "chat", cwd: repo });
    queueFirstMessage(id, `The nightly review found this in existing code, and two reviewers agree: ${where} - ${text}\n\nCheck it's real first (write a failing test for it), then fix it.`);
  };
  return (
    <section className="overnight" aria-label="Found overnight">
      <h2>
        Found overnight
        {running && <span className="num"> · reviewing…</span>}
      </h2>
      <ul>
        {rows.map(({ repo, n, f, key }) => {
          const where = `${f.file ?? n.folder}${f.line ? `:${f.line}` : ""}`;
          return (
            <li key={key}>
              <span className="ov-what">
                <b className="mono">
                  {basename(repo)} · {where}
                </b>
                <span>{f.text}</span>
              </span>
              <button type="button" className="btn sm" onClick={() => fix(repo, where, f.text)}>
                Fix in a thread
              </button>
              <button type="button" className="today-btn sm" onClick={() => dismissFinding(key)}>
                Dismiss
              </button>
            </li>
          );
        })}
        {errors.map(([repo, n]) => (
          <li key={`err-${repo}`} className="ov-err">
            <span className="ov-what">
              <b>{basename(repo)}</b>
              <span>The review didn't run: {n.error}</span>
            </span>
            <button type="button" className="btn sm" disabled={running} onClick={() => void runNightly()}>
              Try again
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
