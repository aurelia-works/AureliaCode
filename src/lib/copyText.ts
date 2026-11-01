import { toast } from "../store/ui";

/** Copies text and says so; says so too when the clipboard refuses. */
export function copyText(text: string, done: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast(done),
    () => toast("Couldn't copy to the clipboard", true),
  );
}
