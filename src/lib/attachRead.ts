import { IMAGE_MAX_BYTES, kindOf, looksLikeText, mediaTypeFor, type Attachment } from "./attachments";
import { ipc, type ChatImage } from "./ipc";

/**
 * Reading files into the composer's attachments (lib/attachments.ts says what each kind becomes).
 * Files come from the picker or a paste (a File, no path) or from a Finder drop (a path,
 * read by the Rust side).
 */

const IMAGE_MAX_SIDE = 2000;

export async function readImage(file: Blob & { type: string }): Promise<ChatImage> {
  const supported = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type);
  if (supported && file.size <= IMAGE_MAX_BYTES) return { mediaType: file.type, data: await base64(file) };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("encode"))), "image/jpeg", 0.85));
  return { mediaType: "image/jpeg", data: await base64(blob) };
}

export function base64(blob: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });
}

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** A chip for a file, before reading: its kind, and an id to update it by. */
export function draftAttachment(name: string, size: number, mime = "", path?: string): Attachment {
  const kind = kindOf(name, mime);
  return { id: crypto.randomUUID(), name, size, kind, mediaType: mediaTypeFor(kind, name, mime), ...(path && { path }), status: "reading" };
}

/** Reads a picked or pasted file into the fields a chip needs to be sent. */
export async function readFile(a: Attachment, file: File): Promise<Partial<Attachment>> {
  if (a.kind === "image") {
    const img = await readImage(file);
    return { mediaType: img.mediaType, data: img.data, status: "ready" };
  }
  if (a.kind === "pdf") return { data: await base64(file), status: "ready" };
  if (a.kind === "text") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (looksLikeText(bytes)) return { data: new TextDecoder().decode(bytes), status: "ready" };
    return { status: "error", error: "Not text. Drop it from Finder to send its path instead" };
  }
  return { status: "error", error: "Can't send this kind of file. Drop it from Finder to send its path" };
}

/** Reads a dropped file by its path; anything that isn't an image, PDF or text goes as the path. */
export async function readPath(a: Attachment): Promise<Partial<Attachment>> {
  if (!a.path) return { status: "error", error: "No path" };
  if (a.kind === "path") return { size: (await ipc.readAttachment(a.path, false)).size, status: "ready" };
  const r = await ipc.readAttachment(a.path, true);
  const bytes = fromBase64(r.data);
  if (a.kind === "text") {
    // Not text after all (a binary with no extension): send the path rather than garbage.
    if (!looksLikeText(bytes)) return { kind: "path", size: r.size, status: "ready" };
    return { size: r.size, data: new TextDecoder().decode(bytes), status: "ready" };
  }
  if (a.kind === "image") {
    const img = await readImage(new Blob([bytes], { type: a.mediaType }));
    return { size: r.size, mediaType: img.mediaType, data: img.data, status: "ready" };
  }
  return { size: r.size, data: r.data, status: "ready" };
}
