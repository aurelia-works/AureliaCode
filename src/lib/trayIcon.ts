import { invoke } from "@tauri-apps/api/core";
import { useAgents } from "../store/agents";
import { useConfig } from "../store/config";
import { squidPaths } from "./squid";

/** Tentacle sway per animation frame, in icon units. */
const SWAY = [0, 0.9, 0, -0.9];
const FRAME_MS = 280;
/** Menu bar height the icon is drawn for; retina doubles it. */
const SCALE = 2;

/** One frame as RGBA. No `color`: black, for a macOS template icon. */
function draw(sway: number, size: number, color: string): { rgba: number[]; px: number } {
  const px = size * SCALE;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const c = canvas.getContext("2d", { willReadFrequently: true })!;
  c.scale(px / 22, px / 22);
  const p = squidPaths(sway);
  c.fillStyle = c.strokeStyle = color || "#000";
  c.lineWidth = 1.5;
  c.lineCap = "round";
  c.fill(new Path2D(p.body));
  c.stroke(new Path2D(p.arms));
  c.globalCompositeOperation = "destination-out";
  for (const x of [9, 13]) {
    c.beginPath();
    c.arc(x, 9.6, 1, 0, Math.PI * 2);
    c.fill();
  }
  return { rgba: Array.from(c.getImageData(0, 0, px, px).data), px };
}

/** Keeps the squid in step with Settings → Menu bar and, when animated, with running threads. */
export function startTrayIcon() {
  let frame = 0;
  let last = "";
  const paint = () => {
    const t = useConfig.getState().config?.tray;
    if (!t) return;
    const working = t.animate && Object.values(useAgents.getState().sessions).some((s) => s.status === "working");
    frame = working ? (frame + 1) % SWAY.length : 0;
    const key = `${t.enabled}|${t.color}|${t.size}|${frame}`;
    if (key === last) return;
    const visibleChanged = last.split("|")[0] !== String(t.enabled);
    last = key;
    if (visibleChanged) invoke("tray_visible", { on: t.enabled }).catch(() => {});
    if (!t.enabled) return;
    const { rgba, px } = draw(SWAY[frame], t.size, t.color);
    invoke("tray_set_icon", { rgba, width: px, height: px, template: !t.color }).catch(() => {});
  };
  useConfig.subscribe(paint);
  paint();
  setInterval(paint, FRAME_MS);
}
