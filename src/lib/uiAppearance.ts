import { getConfig } from "../store/config";

/** Applies the T3-style interface settings that are not terminal colors. */
export function applyUiAppearance() {
  const cfg = getConfig();
  const root = document.documentElement;
  root.dataset.contrast = cfg.contrast === "high" ? "high" : "normal";
  root.dataset.chatWidth = cfg.chatWidth ?? "comfortable";
  root.dataset.motion = cfg.reduceMotion ? "reduced" : "full";
}
