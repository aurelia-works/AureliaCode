import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";
import { useChat } from "../lib/chat";
import {
  COMMENTS_DESC,
  invocationMessage,
  TESTS_DESC,
  untanglePreview,
  untangleSendGate,
  type UntangleAdditions,
} from "../lib/untangle";
import { useLayout } from "../store/layout";
import { useUi } from "../store/ui";

const CHOICES: { id: UntangleAdditions; label: string; desc: string }[] = [
  { id: "refactor", label: "Refactor only", desc: "No comment pass and no test pass." },
  { id: "comments", label: "Refactor plus comments", desc: COMMENTS_DESC },
  { id: "tests", label: "Refactor plus tests", desc: TESTS_DESC },
  { id: "both", label: "Refactor plus comments and tests", desc: `${COMMENTS_DESC} ${TESTS_DESC}` },
];

/**
 * Confirms one `/untangle-codebase` message. The skill text is shown here and is not pasted
 * again: Claude Code applies the installed copy once when this session already lists it.
 */
export function UntangleDialog({
  paneId,
  initialArea,
  withAttachments,
  onClose,
  onSend,
}: {
  paneId: string;
  initialArea: string;
  withAttachments: boolean;
  onClose(): void;
  onSend(message: string): void;
}) {
  const provider = useLayout((s) => s.panes[paneId]?.provider);
  const commands = useChat((s) => s.byPane[paneId]?.commands);
  const status = useChat((s) => s.byPane[paneId]?.status);
  const followUp = useUi((s) => s.prefs.followUp);
  const [area, setArea] = useState(initialArea);
  const [additions, setAdditions] = useState<UntangleAdditions>("refactor");
  const [skill, setSkill] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    ipc.untangleAsset().then(
      (asset) => {
        if (live) setSkill(asset.skill);
      },
      (e) => {
        if (live) setAssetError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const gate = untangleSendGate({ provider, commands });
  const message = invocationMessage(area, additions);
  const preview = skill ? untanglePreview(skill, area, additions) : null;
  const working = status === "working" || status === "waiting";
  const canSend = gate.ok && !!preview;
  const note = !gate.ok
    ? gate.reason
    : !skill
      ? assetError
        ? `The bundled skill text couldn't be loaded (${assetError}), so nothing was sent.`
        : "Loading the bundled skill text…"
      : working
        ? followUp === "steer"
          ? "Sends this one message now, which stops the current turn. Queue and steer stay as they are."
          : "Sends this one message, queued until the current turn ends. Queue and steer stay as they are."
        : "Sends this one message. Claude Code applies the installed skill once with that argument. Nothing runs until you send.";

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal untangle-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="untangle-title"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="modal-head">
          <h2 id="untangle-title">Untangle codebase</h2>
        </div>
        <div className="untangle-body">
          <p className="hint">
            Explicit invocation only: <code>/untangle-codebase [optional area]</code>. Installing the skill does not edit anything. The default is refactor only, so tests are not deleted unless you opt in.
          </p>
          <fieldset className="untangle-choices">
            <legend>Additions</legend>
            {CHOICES.map((choice) => (
              <label key={choice.id} className="untangle-choice">
                <input type="radio" name="untangle-additions" checked={additions === choice.id} onChange={() => setAdditions(choice.id)} />
                <span>
                  <b>{choice.label}</b>
                  <span className="hint inline"> · {choice.desc}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="untangle-area">
            <span>Area or concern</span>
            <input autoFocus value={area} maxLength={400} spellCheck={false} placeholder="Optional, for example src/lib" aria-label="Optional area or concern" onChange={(e) => setArea(e.target.value)} />
          </label>
          <p className="untangle-kicker">Message sent once</p>
          <pre className="untangle-preview">{preview?.message ?? message}</pre>
          <p className="untangle-kicker">Skill text Claude Code applies once with that argument. It is not pasted again.</p>
          <pre className="untangle-skill">{skill ?? (assetError ? "The bundled skill text couldn't be loaded." : "Loading the bundled skill text…")}</pre>
          {withAttachments && <p className="hint">Attachments already on the composer go with this same message.</p>}
        </div>
        <div className="modal-foot">
          <span className="msg">{note}</span>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!canSend} onClick={() => canSend && preview && onSend(preview.message)}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
