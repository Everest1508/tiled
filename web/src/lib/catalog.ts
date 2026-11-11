import { Comp, gid, gridOf, MapData, Rect, Tileset } from "./types";

export const SYMBOL_POOL =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@%&*+=~^!$:;<>-_/\\|";

export const normName = (n: unknown) =>
  String(n ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/^_+|_+$/g, "");

export interface CatalogComp {
  name: string;
  cols: number;
  rows: number;
  gids: number[];
}

export interface Catalog {
  entries: { sym: string; gid: number; name: string }[];
  symToGid: Record<string, number>;
  gidToSym: Map<number, string>;
  comps: Record<string, CatalogComp>;
  text: string;
  empty: boolean;
}

/** Everything Claude may use: named tiles (one symbol each) and named objects. */
export function buildCatalog(tilesets: Tileset[]): Catalog {
  const entries: Catalog["entries"] = [];
  const symToGid: Record<string, number> = {};
  const gidToSym = new Map<number, string>();
  const comps: Record<string, CatalogComp> = {};
  const seen = new Set<string>();

  for (const ts of tilesets) {
    const { count } = gridOf(ts);
    for (const key of Object.keys(ts.names).map(Number).sort((a, b) => a - b)) {
      const name = normName(ts.names[key]);
      if (!name || key >= count || seen.has(name) || entries.length >= SYMBOL_POOL.length) continue;
      seen.add(name);
      const sym = SYMBOL_POOL[entries.length];
      const g = gid(ts.slot, key);
      entries.push({ sym, gid: g, name });
      symToGid[sym] = g;
      gidToSym.set(g, sym);
    }
    for (const c of ts.comps) {
      const name = normName(c.name);
      if (!name || comps[name]) continue;
      comps[name] = { name, cols: c.cols, rows: c.rows, gids: c.ids.map((id) => (id >= 0 ? gid(ts.slot, id) : 0)) };
    }
  }

  let text = "TILE LEGEND (one symbol per tile; '.' means empty):\n";
  text += entries.map((e) => `${e.sym} = ${e.name}`).join("\n") + "\n. = empty\n";
  const compList = Object.values(comps);
  if (compList.length) {
    text += '\nCOMPOSITES (multi-tile objects, placed with "stamps"; x,y is the top-left tile):\n';
    text += compList.map((c) => `${c.name}: ${c.cols}x${c.rows} tiles`).join("\n") + "\n";
  }
  return { entries, symToGid, gidToSym, comps, text, empty: entries.length === 0 };
}

export const SYSTEM_MAP = `You are a level designer who builds tile maps for a tile map editor. You only use the tiles and composites you are told about. Reply with ONE JSON object and nothing else.

JSON format:
{"layers":[{"name":"ground","rows":["aaabb","aabbb"]}],"stamps":[{"layer":"buildings","composite":"house","x":3,"y":2}]}

Rules:
- Each layer has exactly one string per map row and exactly one character per map column, using the legend symbols; '.' is an empty cell.
- Order layers bottom to top: ground/terrain first, then paths and water edges, then objects such as trees and buildings, then decoration.
- Make the map coherent: terrain transitions use edge/corner tiles when they exist, paths connect, buildings sit on valid ground and face a path, nothing floats.
- Use composites through "stamps" so that multi-tile objects stay intact.
- Never invent symbols or composite names.
`;

export function generationPrompt(cat: Catalog, description: string, w: number, h: number) {
  return `${cat.text}\nMAP SIZE: ${w} columns x ${h} rows (every layer must have ${h} rows of ${w} characters).\n\nMAP DESCRIPTION: ${description}`;
}

export function layerRows(map: MapData, cat: Catalog, area: Rect) {
  let out = "";
  for (const l of map.layers) {
    out += `\nLAYER "${l.name}":\n`;
    for (let y = area.y; y < area.y + area.h; y++) {
      let row = "";
      for (let x = area.x; x < area.x + area.w; x++) {
        const g = l.cells[y * map.w + x];
        row += g ? (cat.gidToSym.get(g) ?? "?") : ".";
      }
      out += row + "\n";
    }
  }
  return out;
}

export function variantsPrompt(cat: Catalog, map: MapData, region: Rect, description: string, count: number) {
  const M = 3;
  const x0 = Math.max(0, region.x - M);
  const y0 = Math.max(0, region.y - M);
  const x1 = Math.min(map.w, region.x + region.w + M);
  const y1 = Math.min(map.h, region.y + region.h + M);
  let text = cat.text;
  text += `\nThe existing map is ${map.w}x${map.h}. I want to redo the REGION x=${region.x} y=${region.y} width=${region.w} height=${region.h}.\n`;
  text += `Below is the current content of the region plus ${M} tiles of surroundings (context rows start at x=${x0} y=${y0}). Your new region must blend with the surroundings.\n`;
  text += layerRows(map, cat, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  text += `\nCreate ${count} clearly different alternatives for the REGION only. Reply with {"variants":[{"label":"short name","layers":[...],"stamps":[...]}, ...]}. `;
  text += `Inside a variant, layers must be exactly ${region.h} rows of ${region.w} characters (the region only, not the surroundings) and stamp coordinates are relative to the region's top-left. Use the same layer names as above.\n`;
  if (description.trim()) text += `\nWHAT I WANT IN THE REGION: ${description.trim()}\n`;
  return text;
}

export function refinePrompt(cat: Catalog, map: MapData, instruction: string) {
  let text = cat.text;
  text += `\nThe current map is ${map.w} columns x ${map.h} rows. Its layers are:\n`;
  text += layerRows(map, cat, { x: 0, y: 0, w: map.w, h: map.h });
  text += `\nApply this change and return the COMPLETE updated map (all layers, every layer exactly ${map.h} rows of ${map.w} characters), keeping everything that is not affected by the change: ${instruction.trim()}\n`;
  return text;
}

export function namingPrompt(ts: Tileset, cols: number, rows: number, count: number, hint: string, usedNames: string[]) {
  return `This is a tileset image. Tiles are ${ts.tw}x${ts.th} px, in a grid of ${cols} columns and ${rows} rows (${count} tiles). Each tile has its id (row-major, starting at 0) drawn in its top-left corner; the grid is overlaid in magenta.

Give every non-empty tile a short lowercase snake_case name that describes what it is and how it is used (for example grass, water, water_edge_top, road_corner_ne, road_straight_h, tree, roof_left, wall_door). Names must be unique. Leave out fully transparent tiles. For variants use a numeric suffix (grass_2).${usedNames.length ? `\nThese names are already taken by other tilesheets, do not reuse them: ${usedNames.join(", ")}.` : ""}

Also list composites: objects made of several adjacent tiles such as houses, trees, bridges or wells. For each give a name, cols, rows and the tile ids row-major (use -1 for an empty cell).

${hint.trim() ? `Context from the user: ${hint.trim()}\n\n` : ""}Reply with ONE JSON object only:
{"tiles":[{"id":0,"name":"grass"}],"composites":[{"name":"house","cols":3,"rows":3,"ids":[10,11,12,20,21,22,30,31,32]}]}`;
}

export function selectionNamePrompt(cols: number, rows: number) {
  return `This image shows a ${cols}x${rows} block of tiles cut from a 2D game tileset. Reply with ONE JSON object only: {"name":"short_snake_case_name"} naming what the block depicts (for example house, oak_tree, wooden_bridge, grass_edge_top). Use a numeric suffix only if several similar things exist.`;
}

/** Validates composites coming from Claude. */
export function cleanComps(raw: unknown, count: number): Comp[] {
  const out: Comp[] = [];
  if (!Array.isArray(raw)) return out;
  for (const c of raw) {
    const name = normName(c?.name);
    const cols = Math.floor(Number(c?.cols));
    const rows = Math.floor(Number(c?.rows));
    const ids = Array.isArray(c?.ids) ? c.ids.map((v: unknown) => Math.floor(Number(v))) : [];
    if (!name || !(cols >= 1) || !(rows >= 1) || ids.length !== cols * rows) continue;
    if (ids.some((id: number) => !Number.isFinite(id) || id >= count)) continue;
    out.push({ name, cols, rows, ids: ids.map((id: number) => (id < 0 ? -1 : id)) });
  }
  return out;
}
