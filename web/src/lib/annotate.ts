import { loadImage } from "./images";
import { gridOf, tileOrigin, Tileset } from "./types";

/** Tileset image with the grid and tile ids drawn on it, as a PNG data URL for Claude. */
export async function annotatedTilesetImage(ts: Tileset): Promise<string> {
  const img = await loadImage(ts);
  const { cols, count } = gridOf(ts);
  let scale = Math.max(1, Math.ceil(48 / Math.min(ts.tw, ts.th)));
  scale = Math.min(scale, 1500 / Math.max(ts.width, ts.height));
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(ts.width * scale));
  cv.height = Math.max(1, Math.round(ts.height * scale));
  const g = cv.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#2b2f3a";
  g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(img, 0, 0, cv.width, cv.height);
  const fs = Math.max(9, Math.min(16, Math.floor((Math.min(ts.tw, ts.th) * scale) / 3)));
  g.font = `bold ${fs}px sans-serif`;
  g.textBaseline = "top";
  for (let id = 0; id < count; id++) {
    const { sx, sy } = tileOrigin(ts, id);
    const x = sx * scale;
    const y = sy * scale;
    g.strokeStyle = "rgba(255,0,255,.65)";
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, ts.tw * scale, ts.th * scale);
    g.fillStyle = "#000";
    g.fillText(String(id), x + 3, y + 2);
    g.fillStyle = "#ffe84d";
    g.fillText(String(id), x + 2, y + 1);
  }
  void cols;
  return cv.toDataURL("image/png");
}

/** Crops a block of tiles (inclusive tile coordinates) and enlarges it. */
export async function selectionImage(ts: Tileset, c0: number, r0: number, c1: number, r1: number): Promise<string> {
  const img = await loadImage(ts);
  const { cols } = gridOf(ts);
  const a = tileOrigin(ts, r0 * cols + c0);
  const w = (c1 - c0 + 1) * ts.tw + (c1 - c0) * ts.spacing;
  const h = (r1 - r0 + 1) * ts.th + (r1 - r0) * ts.spacing;
  const scale = Math.max(1, Math.min(8, Math.floor(256 / Math.max(w, h))));
  const cv = document.createElement("canvas");
  cv.width = w * scale;
  cv.height = h * scale;
  const g = cv.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#2b2f3a";
  g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(img, a.sx, a.sy, w, h, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/png");
}
