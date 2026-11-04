/**
 * Files in a chat message: what each kind becomes for Claude Code, and the size cap. Pure,
 * for `node --test`; reading files and the chips live in ChatPane.
 *
 * Claude Code's stream-json input takes the API's content blocks as they are (checked with
 * claude 2.1.318): images as `image` blocks, PDFs as base64 `document` blocks, text as
 * `document` blocks with a text source. Anything else is sent as its path, for Claude to
 * read from disk, and the chip says so. Nothing is converted silently.
 */

export type AttachKind = "image" | "pdf" | "text" | "path";

export interface Attachment {
  id: string;
  name: string;
  /** Bytes on disk. */
  size: number;
  kind: AttachKind;
  mediaType: string;
  /** base64 for images and PDFs, the text itself for text. */
  data?: string;
  /** Where the file is on disk, when known (Finder drops). A "path" chip sends this. */
  path?: string;
  status: "reading" | "ready" | "error";
  error?: string;
}

/** What one document block carries to the Rust side (`chat_send`). */
export interface ChatDocument {
  kind: "pdf" | "text";
  name: string;
  data: string;
}

/** A message's attachments together, as sent: the API refuses requests over 32 MB. */
export const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const TEXT_EXTENSIONS = [
  "txt", "md", "markdown", "mdx", "json", "jsonl", "csv", "tsv", "yaml", "yml", "toml", "xml", "html", "htm", "css", "scss", "less",
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "c", "h", "cc", "cpp", "hpp", "m", "mm",
  "cs", "php", "sh", "zsh", "bash", "fish", "sql", "log", "ini", "cfg", "conf", "env", "lua", "r", "dart", "vue", "svelte", "astro",
  "gradle", "properties", "graphql", "proto", "tf", "diff", "patch", "srt", "vtt", "tex", "rst", "org",
];
/** For the picker's `accept`. */
export const ACCEPT = {
  images: IMAGE_TYPES.join(","),
  pdfs: "application/pdf,.pdf",
  text: TEXT_EXTENSIONS.map((e) => `.${e}`).join(","),
};

const ext = (name: string) => (/\.([^./]+)$/.exec(name)?.[1] ?? "").toLowerCase();

/** What a file becomes: an image block, a PDF block, a text block, or its path. */
export function kindOf(name: string, mime = ""): AttachKind {
  const e = ext(name);
  if (IMAGE_TYPES.includes(mime) || ["png", "jpg", "jpeg", "gif", "webp"].includes(e)) return "image";
  // Other image formats (HEIC, TIFF) are converted to JPEG when read (lib/attachRead.ts).
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || e === "pdf") return "pdf";
  if (mime.startsWith("text/") || TEXT_EXTENSIONS.includes(e) || ["application/json", "application/xml", "application/x-yaml", "application/toml"].includes(mime))
    return "text";
  // Dotfiles and extensionless names like Makefile, Dockerfile: text, if they decode as it.
  if (!e && !mime) return "text";
  return "path";
}

/** The media type a kind is sent as. */
export function mediaTypeFor(kind: AttachKind, name: string, mime = ""): string {
  if (kind === "pdf") return "application/pdf";
  if (kind === "text") return "text/plain";
  if (kind === "image") {
    if (IMAGE_TYPES.includes(mime)) return mime;
    const e = ext(name);
    return e === "jpg" || e === "jpeg" ? "image/jpeg" : e === "png" ? "image/png" : e === "gif" ? "image/gif" : e === "webp" ? "image/webp" : mime || "image/png";
  }
  return mime || "application/octet-stream";
}

/** Images bigger than this (or over 2000 px) are scaled down and re-encoded (lib/attachRead.ts). */
export const IMAGE_MAX_BYTES = 3_500_000;

/** Bytes this attachment adds to the request (base64 is already its sent size). */
export function sentBytes(a: Pick<Attachment, "kind" | "data" | "size">): number {
  if (a.kind === "path") return 0;
  // An image's sent size is only known once it's scaled (often far below IMAGE_MAX_BYTES), so an
  // unread one counts as nothing and settleRead checks the cap when it's read.
  if (!a.data) return a.kind === "text" ? a.size : a.kind === "image" ? 0 : Math.ceil(a.size / 3) * 4;
  return a.kind === "text" ? new TextEncoder().encode(a.data).length : a.data.length;
}

/** Why one more of `size` sent bytes can't join `list`, or null when it fits. */
export function capError(list: Pick<Attachment, "kind" | "data" | "size" | "status">[], adding: number): string | null {
  const live = list.filter((a) => a.status !== "error");
  if (live.length >= MAX_ATTACHMENTS) return `A message holds up to ${MAX_ATTACHMENTS} files`;
  const used = live.reduce((n, a) => n + sentBytes(a), 0);
  if (used + adding > MAX_MESSAGE_BYTES) return `Over the ${formatSize(MAX_MESSAGE_BYTES)} a message can carry (${formatSize(used)} attached)`;
  return null;
}

/**
 * Applies a finished read to chip `id`. A dropped file's size is only known once read, so the
 * cap is checked again here: one that no longer fits becomes an error chip without its bytes.
 */
export function settleRead<T extends Attachment>(list: T[], id: string, patch: Partial<Attachment>): T[] {
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) return list;
  const done = { ...list[i], ...patch } as T;
  if (done.status === "ready" && done.kind !== "path" && !done.data) {
    const { data: _, ...rest } = done;
    return list.map((a, j) => (j === i ? ({ ...rest, status: "error", error: "Empty file, nothing to send" } as T) : a));
  }
  if (done.status === "ready") {
    const why = capError(list.filter((a) => a.id !== id), sentBytes(done));
    if (why) {
      const { data: _, ...rest } = done;
      return list.map((a, j) => (j === i ? ({ ...rest, status: "error", error: why } as T) : a));
    }
  }
  return list.map((a, j) => (j === i ? done : a));
}

/** Why the message can't be sent with these attachments yet, or null when it can. */
export function sendProblem(atts: Pick<Attachment, "status">[]): string | null {
  if (atts.some((a) => a.status === "reading")) return "Still reading the attached files";
  if (atts.some((a) => a.status === "error")) return "Remove the files marked in red first: they can't be sent";
  return null;
}

/** "812 B", "14 KB", "3.2 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** True when bytes decode as UTF-8 text (no NULs, no invalid sequences). */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** The ready attachments split the way `chat_send` takes them, plus the path mentions for the text. */
export function forSend(list: Attachment[]): { images: { mediaType: string; data: string }[]; documents: ChatDocument[]; refs: string } {
  const ready = list.filter((a) => a.status === "ready");
  const images = ready.filter((a) => a.kind === "image" && a.data).map((a) => ({ mediaType: a.mediaType, data: a.data! }));
  const documents = ready
    .filter((a): a is Attachment & { kind: "pdf" | "text"; data: string } => (a.kind === "pdf" || a.kind === "text") && !!a.data)
    .map((a) => ({ kind: a.kind, name: a.name, data: a.data }));
  const refs = ready
    .filter((a) => a.kind === "path" && a.path)
    .map((a) => `@${/\s/.test(a.path!) ? `"${a.path}"` : a.path}`)
    .join(" ");
  return { images, documents, refs };
}

/** What the chip says under the name. */
export function chipNote(a: Pick<Attachment, "kind" | "size" | "status" | "error" | "mediaType">): string {
  if (a.status === "reading") return "Reading…";
  if (a.status === "error") return a.error ?? "Couldn't read it";
  const size = formatSize(a.size);
  if (a.kind === "path") return `${size} · sent as its path`;
  if (a.kind === "pdf") return `PDF · ${size}`;
  if (a.kind === "text") return `Text · ${size}`;
  return size;
}
