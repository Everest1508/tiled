import { getImage } from "./images";
import { previewCell } from "./mapops";
import { gidLocal, gidSlot, MapData, Rect, tileOrigin, Tileset, Variant } from "./types";

export function drawTileGid(ctx: CanvasRenderingContext2D, byslot: Map<number, Tileset>, g: number, dx: number, dy: number, dw: number, dh: number) {
  const ts = byslot.get(gidSlot(g));
  if (!ts) return;
  const img = getImage(ts);
  if (!img) return;
  const { sx, sy } = tileOrigin(ts, gidLocal(g));
  ctx.drawImage(img, sx, sy, ts.tw, ts.th, dx, dy, dw, dh);
}

export interface DrawMapOptions {
  tilesets: Tileset[];
  /** Pixel size of one tile on screen. */
  cell: number;
  offsetX?: number;
  offsetY?: number;
  grid?: boolean;
  region?: Rect | null;
  preview?: { variant: Variant; region: Rect } | null;
  activeLayerId?: string | null;
}

/** Draws every visible layer; used by the editor, the previews and PNG export. */
export function drawMap(ctx: CanvasRenderingContext2D, map: MapData, o: DrawMapOptions) {
  const byslot = new Map(o.tilesets.map((t) => [t.slot, t]));
  const ox = o.offsetX ?? 0;
  const oy = o.offsetY ?? 0;
  const c = o.cell;
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = "#12141a";
  ctx.fillRect(ox, oy, map.w * c, map.h * c);

  map.layers.forEach((layer, li) => {
    if (!layer.visible) return;
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const g = previewCell(map, li, x, y, o.preview ?? undefined);
        if (g) drawTileGid(ctx, byslot, g, ox + x * c, oy + y * c, c, c);
      }
    }
  });

  if (o.grid && c >= 10) {
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= map.w; x++) {
      ctx.moveTo(Math.round(ox + x * c) + 0.5, oy);
      ctx.lineTo(Math.round(ox + x * c) + 0.5, oy + map.h * c);
    }
    for (let y = 0; y <= map.h; y++) {
      ctx.moveTo(ox, Math.round(oy + y * c) + 0.5);
      ctx.lineTo(ox + map.w * c, Math.round(oy + y * c) + 0.5);
    }
    ctx.stroke();
  }

  if (o.region) {
    const r = o.region;
    ctx.save();
    ctx.fillStyle = "rgba(124,92,255,.18)";
    ctx.fillRect(ox + r.x * c, oy + r.y * c, r.w * c, r.h * c);
    ctx.strokeStyle = "#a995ff";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(ox + r.x * c + 1, oy + r.y * c + 1, r.w * c - 2, r.h * c - 2);
    ctx.restore();
  }
}

/** Renders the whole map into a standalone canvas (thumbnails, PNG export). */
export function renderToCanvas(map: MapData, tilesets: Tileset[], cell: number, preview?: DrawMapOptions["preview"]) {
  const cv = document.createElement("canvas");
  cv.width = map.w * cell;
  cv.height = map.h * cell;
  const ctx = cv.getContext("2d")!;
  drawMap(ctx, map, { tilesets, cell, preview });
  return cv;
}
