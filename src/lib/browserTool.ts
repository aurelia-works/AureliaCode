/** `aurelia_browser` calls, read back from a chat transcript for a card instead of a raw JSON tool line. */
export type BrowserTool = "browser";

export interface BrowserAction {
  action: string;
  pane?: string;
  url?: string;
  ref?: string;
  selector?: string;
  kind?: string;
  /** One line: what it did, for the card header. */
  summary: string;
  /** The page's snapshot tree, when the action returned one. */
  text?: string;
  /** Screenshot file path. */
  image?: string;
  width?: number;
  height?: number;
  target?: string;
  note?: string;
  ok: boolean;
  error?: string;
  /** The unparsed reply, for an action this card doesn't know yet. */
  raw?: string;
}

export function browserTool(name: string): BrowserTool | null {
  const tool = name.replace(/^mcp__.+?__/, "");
  return tool === "aurelia_browser" ? "browser" : null;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function parsePayload(result: string | undefined): { data?: Record<string, unknown>; raw?: string; error?: string } {
  if (result === undefined) return {};
  // The MCP result is JSON text; an image block is appended as "[image]" by the transcript.
  const clean = result.replace(/\n?\[image\]\s*$/, "").trim();
  if (!clean) return { raw: "" };
  try {
    const v = JSON.parse(clean);
    if (v && typeof v === "object" && !Array.isArray(v)) return { data: v as Record<string, unknown> };
    return { raw: clean };
  } catch {
    return { raw: clean, error: clean.startsWith("Error") || /^[A-Z].*failed/.test(clean) ? clean : undefined };
  }
}

function label(action: string, d: Record<string, unknown>, input: Record<string, unknown>): string {
  const kind = str(input.kind) ?? "click";
  const target = str(d.target) ?? str(input.ref) ?? str(input.selector) ?? "the page";
  switch (action) {
    case "open": {
      const title = str(d.title);
      const url = str(d.url) ?? str(input.url);
      return title ? `Opened ${title}` : url ? `Opened ${url}` : "Opened the page";
    }
    case "snapshot": {
      const lines = str(d.text)?.split("\n").length;
      return lines ? `Snapshot · ${lines} lines` : "Snapshot";
    }
    case "act":
      if (kind === "type") return `Typed into ${target}`;
      if (kind === "press") return `Pressed ${str(input.key) ?? "a key"} on ${target}`;
      if (kind === "hover") return `Hovered ${target}`;
      if (kind === "select") return `Selected ${str(input.value) ?? ""} in ${target}`;
      if (kind === "scroll") return "Scrolled the page";
      return `Clicked ${target}`;
    case "wait":
      return d.ok === false ? `Wait timed out${d.reason ? ` (${str(d.reason)})` : ""}` : `Waited · ${num(d.waitedMs) ?? 0} ms`;
    case "resize": {
      const vp = d.viewport as Record<string, unknown> | undefined;
      return vp ? `Viewport ${num(vp.w) ?? "?"}×${num(vp.h) ?? "?"}` : "Resized the viewport";
    }
    case "inspect": {
      const rect = d.rect as Record<string, unknown> | undefined;
      return rect ? `Inspected ${target} · ${num(rect.w) ?? "?"}×${num(rect.h) ?? "?"}` : `Inspected ${target}`;
    }
    case "screenshot":
      return num(d.width) && num(d.height) ? `Screenshot ${num(d.width)}×${num(d.height)}` : "Screenshot";
    default:
      return action;
  }
}

export function parseBrowserAction(name: string, input: Record<string, unknown>, result: string | undefined, isError?: boolean): BrowserAction | null {
  if (!browserTool(name)) return null;
  const action = str(input.action) ?? "browser";
  const parsed = parsePayload(result);
  // orchestrator.rs sends a snapshot's tree as bare text, not JSON: that text is the tree.
  const plainTree = !parsed.data && action === "snapshot" && !isError && !parsed.error && !!parsed.raw;
  const { data, raw, error } = plainTree ? { data: { text: parsed.raw }, raw: undefined, error: undefined } : parsed;
  const d: Record<string, unknown> = data ?? {};
  const failure = str(d.error) ?? error ?? (isError ? raw || "The browser action failed" : undefined);
  return {
    action,
    pane: str(d.pane) ?? str(input.pane),
    url: str(d.url) ?? str(input.url),
    ref: str(input.ref),
    selector: str(input.selector),
    kind: str(input.kind),
    summary: failure ? failure : label(action, d, input),
    text: str(d.text),
    image: str(d.image),
    width: num(d.width),
    height: num(d.height),
    target: str(d.target),
    note: str(d.note),
    ok: !failure && result !== undefined,
    error: failure,
    raw: data ? undefined : raw,
  };
}
