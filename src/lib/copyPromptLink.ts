import { useChat } from "./chat";
import { drafts } from "./chatComposer";
import { buildPromptLink } from "./promptLink";
import { toast } from "../store/ui";

/** Copies `aureliaspace://new?prompt=…` for a chat's unsent draft, else its first message. Opening it only drafts. */
export function copyPromptLink(paneId: string) {
  const draft = drafts.get(paneId)?.text?.trim();
  const first = useChat.getState().byPane[paneId]?.transcript.items.find((i) => i.kind === "user");
  const text = draft || (first?.kind === "user" ? first.text : "");
  const link = text ? buildPromptLink(text, {}) : null;
  if (!link) return toast("Nothing to link: write a draft or send a message first", true);
  void navigator.clipboard.writeText(link).then(
    () => toast(draft ? "Prompt link copied (from the draft)" : "Prompt link copied (from the first message)"),
    () => toast("Couldn't copy the prompt link to the clipboard", true),
  );
}
