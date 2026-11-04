import { chipNote, type Attachment } from "../lib/attachments";
import { FileIcon } from "./Icons";

const KIND: Record<Attachment["kind"], string> = { image: "IMG", pdf: "PDF", text: "TXT", path: "PATH" };

/** The composer's attachments: a thumbnail or kind badge, the name, what happens to it, and remove. */
export function AttachChips({ atts, onRemove }: { atts: Attachment[]; onRemove: (id: string) => void }) {
  return (
    <ul className="chat-attach" aria-label="Attached files">
      {atts.map((a) => (
        <li key={a.id} className={`chat-chip ${a.kind} ${a.status}`} title={a.path ?? a.name}>
          {a.kind === "image" && a.data ? (
            <img className="chat-chip-thumb" src={`data:${a.mediaType};base64,${a.data}`} alt="" />
          ) : (
            <span className="chat-chip-badge" aria-hidden>
              {a.kind === "path" ? <FileIcon /> : KIND[a.kind]}
            </span>
          )}
          <span className="chat-chip-text">
            <span className="chat-chip-name">{a.name}</span>
            <span className="chat-chip-note" role={a.status === "error" ? "alert" : undefined}>
              {chipNote(a)}
            </span>
          </span>
          <button type="button" className="chat-chip-x" aria-label={`Remove ${a.name}`} title="Remove" onClick={() => onRemove(a.id)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Files a sent message carried, by name. */
export function SentFiles({ names }: { names: string[] }) {
  return (
    <div className="chat-user-files">
      {names.map((n, i) => (
        <span key={i} className="chat-user-file">
          <FileIcon />
          {n}
        </span>
      ))}
    </div>
  );
}
