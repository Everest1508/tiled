import { gridOf, gidLocal, gidSlot, MapData, Tileset } from "./types";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tileset";

/** File names used for tileset images inside the exported .tmj. */
export function tilesetFileNames(tilesets: Tileset[]) {
  const used = new Set<string>();
  return tilesets.map((ts) => {
    let base = slug(ts.name);
    let n = 2;
    let name = base;
    while (used.has(name)) name = `${base}-${n++}`;
    used.add(name);
    return `${name}.png`;
  });
}

/** Builds a Tiled JSON map (.tmj) that references one image file per tileset. */
export function toTmj(map: MapData, tilesets: Tileset[]) {
  const files = tilesetFileNames(tilesets);
  const firstgid = new Map<number, number>(); // slot -> firstgid
  let next = 1;
  const tmjTilesets = tilesets.map((ts, i) => {
    const { cols, count } = gridOf(ts);
    firstgid.set(ts.slot, next);
    const entry = {
      firstgid: next,
      name: ts.name,
      image: files[i],
      imagewidth: ts.width,
      imageheight: ts.height,
      tilewidth: ts.tw,
      tileheight: ts.th,
      margin: ts.margin,
      spacing: ts.spacing,
      columns: cols,
      tilecount: count,
      tiles: Object.entries(ts.names)
        .filter(([, n]) => n)
        .map(([id, n]) => ({ id: Number(id), type: n })),
    };
    next += count;
    return entry;
  });

  const tw = tilesets[0]?.tw ?? 16;
  const th = tilesets[0]?.th ?? 16;
  return {
    compressionlevel: -1,
    width: map.w,
    height: map.h,
    infinite: false,
    orientation: "orthogonal",
    renderorder: "right-down",
    tilewidth: tw,
    tileheight: th,
    type: "map",
    version: "1.10",
    tiledversion: "1.11.0",
    nextlayerid: map.layers.length + 1,
    nextobjectid: 1,
    tilesets: tmjTilesets,
    layers: map.layers.map((l, i) => ({
      id: i + 1,
      name: l.name,
      type: "tilelayer",
      x: 0,
      y: 0,
      width: map.w,
      height: map.h,
      opacity: 1,
      visible: l.visible,
      data: Array.from(l.cells, (g) => {
        if (!g) return 0;
        const first = firstgid.get(gidSlot(g));
        return first === undefined ? 0 : first + gidLocal(g);
      }),
    })),
  };
}

// ---- Project files --------------------------------------------------------

export interface ProjectFile {
  app: "tile-map-studio";
  version: 1;
  name: string;
  nextSlot: number;
  tilesets: Tileset[];
  map: null | { w: number; h: number; layers: { id: string; name: string; visible: boolean; cells: number[] }[] };
}

export function toProject(name: string, nextSlot: number, tilesets: Tileset[], map: MapData | null): ProjectFile {
  return {
    app: "tile-map-studio",
    version: 1,
    name,
    nextSlot,
    tilesets,
    map: map && { w: map.w, h: map.h, layers: map.layers.map((l) => ({ ...l, cells: Array.from(l.cells) })) },
  };
}

export function fromProject(raw: any): { name: string; nextSlot: number; tilesets: Tileset[]; map: MapData | null } {
  if (!raw || raw.app !== "tile-map-studio" || !Array.isArray(raw.tilesets)) throw new Error("This is not a Tile Map Studio project file.");
  const tilesets: Tileset[] = raw.tilesets.map((t: any) => ({
    id: String(t.id),
    slot: Number(t.slot),
    name: String(t.name),
    src: String(t.src),
    width: Number(t.width),
    height: Number(t.height),
    tw: Number(t.tw),
    th: Number(t.th),
    margin: Number(t.margin) || 0,
    spacing: Number(t.spacing) || 0,
    names: t.names ?? {},
    comps: Array.isArray(t.comps) ? t.comps : [],
  }));
  const map = raw.map
    ? {
        w: Number(raw.map.w),
        h: Number(raw.map.h),
        layers: raw.map.layers.map((l: any) => ({ id: String(l.id), name: String(l.name), visible: l.visible !== false, cells: Int32Array.from(l.cells) })),
      }
    : null;
  return { name: String(raw.name || "Untitled map"), nextSlot: Number(raw.nextSlot) || tilesets.length, tilesets, map };
}
