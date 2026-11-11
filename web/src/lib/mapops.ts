import { Catalog, normName } from "./catalog";
import { Layer, MapData, Rect, Variant } from "./types";

export const uid = () => Math.random().toString(36).slice(2, 9);

export function newMap(w: number, h: number): MapData {
  return { w, h, layers: [] };
}

export function newLayer(map: MapData, name: string): Layer {
  return { id: uid(), name, visible: true, cells: new Int32Array(map.w * map.h) };
}

export function cloneMap(m: MapData): MapData {
  return { w: m.w, h: m.h, layers: m.layers.map((l) => ({ ...l, cells: l.cells.slice() })) };
}

/** Takes the first JSON object out of a reply, tolerating code fences and prose. */
export function extractJson(text: string): any {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("The AI's reply did not contain a map. Try again.");
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    throw new Error("The AI's reply was not valid JSON. Try again.");
  }
}

/** Writes the layers and stamps of a reply into `map`, creating layers as needed. */
export function fillLayers(map: MapData, reply: any, cat: Catalog, warnings: string[] = []): MapData {
  const layerNamed = (name: string) => {
    let l = map.layers.find((x) => x.name === name);
    if (!l) {
      l = newLayer(map, name);
      map.layers.push(l);
    }
    return l;
  };

  for (const L of Array.isArray(reply?.layers) ? reply.layers : []) {
    const layer = layerNamed(String(L?.name || `Layer ${map.layers.length + 1}`));
    const rows: unknown[] = Array.isArray(L?.rows) ? L.rows : [];
    if (rows.length !== map.h) warnings.push(`Layer "${layer.name}" has ${rows.length} rows instead of ${map.h}`);
    for (let y = 0; y < map.h && y < rows.length; y++) {
      const row = String(rows[y]);
      if (row.length !== map.w) warnings.push(`Layer "${layer.name}" row ${y + 1} has ${row.length} columns instead of ${map.w}`);
      for (let x = 0; x < map.w && x < row.length; x++) {
        const c = row[x];
        if (c === "." || c === " " || c === "?") continue;
        const g = cat.symToGid[c];
        if (g) layer.cells[y * map.w + x] = g;
        else warnings.push(`Unknown symbol "${c}" at ${x},${y}`);
      }
    }
  }

  for (const st of Array.isArray(reply?.stamps) ? reply.stamps : []) {
    const comp = cat.comps[normName(st?.composite)];
    if (!comp) {
      warnings.push(`Unknown object "${st?.composite}"`);
      continue;
    }
    const layer = layerNamed(String(st?.layer || "objects"));
    const ox = Math.floor(Number(st?.x) || 0);
    const oy = Math.floor(Number(st?.y) || 0);
    stampInto(layer, map, ox, oy, comp.cols, comp.rows, comp.gids);
  }
  return map;
}

/** Writes a block of tile ids into a layer, clipped to the map. */
export function stampInto(layer: Layer, map: MapData, ox: number, oy: number, cols: number, rows: number, gids: number[]) {
  let changed = false;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const g = gids[cy * cols + cx];
      const x = ox + cx;
      const y = oy + cy;
      if (!g || x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      const i = y * map.w + x;
      if (layer.cells[i] !== g) {
        layer.cells[i] = g;
        changed = true;
      }
    }
  }
  return changed;
}

export function clampRegion(r: Rect, map: MapData, max = 32): Rect {
  const x = Math.max(0, Math.min(map.w - 1, r.x));
  const y = Math.max(0, Math.min(map.h - 1, r.y));
  const w = Math.max(1, Math.min(max, r.w, map.w - x));
  const h = Math.max(1, Math.min(max, r.h, map.h - y));
  return { x, y, w, h };
}

/** Returns a copy of `map` with the variant's layers pasted over the region. */
export function applyVariant(map: MapData, variant: Variant, region: Rect): { map: MapData; applied: number } {
  const out = cloneMap(map);
  let applied = 0;
  for (const vl of variant.map.layers) {
    const target = out.layers.find((l) => l.name === vl.name);
    if (!target) continue;
    for (let y = 0; y < region.h; y++) {
      for (let x = 0; x < region.w; x++) {
        target.cells[(region.y + y) * out.w + region.x + x] = vl.cells[y * region.w + x];
      }
    }
    applied++;
  }
  return { map: out, applied };
}

/** Cell value at x,y of a layer, optionally showing a variant preview inside the region. */
export function previewCell(map: MapData, layerIndex: number, x: number, y: number, preview?: { variant: Variant; region: Rect }) {
  const layer = map.layers[layerIndex];
  if (preview) {
    const { region, variant } = preview;
    if (x >= region.x && y >= region.y && x < region.x + region.w && y < region.y + region.h) {
      const vl = variant.map.layers.find((l) => l.name === layer.name);
      if (vl) return vl.cells[(y - region.y) * region.w + (x - region.x)];
    }
  }
  return layer.cells[y * map.w + x];
}

export function mapIsEmpty(m: MapData) {
  return m.layers.every((l) => l.cells.every((c) => c === 0));
}
