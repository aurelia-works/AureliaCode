// Changed areas between a before and an after screenshot, as numbered boxes for the PR
// (scripts/preview-shots.mjs). The page compares pixels into a coarse grid of changed cells;
// this groups the cells into boxes. Pure, for `node --test`.

export interface CellBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Boxes around changed cells (`mask[y * cols + x]` is 1). Cells up to `gap` cells apart join
 * one box. At most `max` boxes, biggest first; `more` counts the ones left out.
 */
export function diffBoxes(mask: Uint8Array, cols: number, rows: number, gap = 1, max = 9): { boxes: CellBox[]; more: number } {
  const seen = new Uint8Array(mask.length);
  const found: CellBox[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let x0 = cols, y0 = rows, x1 = -1, y1 = -1;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const cx = i % cols, cy = (i - cx) / cols;
      x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
      for (let dy = -gap - 1; dy <= gap + 1; dy++)
        for (let dx = -gap - 1; dx <= gap + 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          if (mask[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
    }
    found.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  // Boxes grown from different seeds can still overlap; merge until none do.
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < found.length && !merged; i++)
      for (let j = i + 1; j < found.length; j++) {
        const a = found[i], b = found[j];
        if (a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h) {
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
          found[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
          found.splice(j, 1);
          merged = true;
          break;
        }
      }
  }
  found.sort((a, b) => b.w * b.h - a.w * a.h || a.y - b.y || a.x - b.x);
  return { boxes: found.slice(0, max), more: Math.max(0, found.length - max) };
}

/** "1. 320×48 at (80, 800), bottom left": size and place in CSS pixels. */
export function legendLine(n: number, b: CellBox, cellCss: number, width: number, height: number): string {
  const [x, y, w, h] = [b.x, b.y, b.w, b.h].map((v) => v * cellCss);
  const cx = (x + w / 2) / width, cy = (y + h / 2) / height;
  const col = cx < 1 / 3 ? "left" : cx > 2 / 3 ? "right" : "";
  const row = cy < 1 / 3 ? "top" : cy > 2 / 3 ? "bottom" : "";
  const where = row && col ? `${row} ${col}` : row || col || "middle";
  return `${n}. ${w}×${h} at (${x}, ${y}), ${where}`;
}
