export interface Comp {
  name: string;
  cols: number;
  rows: number;
  /** Local tile ids within the tileset, row-major, -1 = empty cell. */
  ids: number[];
}

export interface Tileset {
  id: string;
  /** Stable slot number, used to build global tile ids that survive reordering. */
  slot: number;
  name: string;
  /** Image as a data URL so projects can be saved and restored. */
  src: string;
  width: number;
  height: number;
  tw: number;
  th: number;
  margin: number;
  spacing: number;
  names: Record<number, string>;
  comps: Comp[];
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  /** Global tile ids (see gid()), 0 = empty. */
  cells: Int32Array;
}

export interface MapData {
  w: number;
  h: number;
  layers: Layer[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Variant {
  label: string;
  map: MapData;
}

export const SLOT_SIZE = 65536;

/** Global tile id from a tileset slot and a local id. 0 means empty. */
export const gid = (slot: number, local: number) => slot * SLOT_SIZE + local + 1;
export const gidSlot = (g: number) => Math.floor((g - 1) / SLOT_SIZE);
export const gidLocal = (g: number) => (g - 1) % SLOT_SIZE;

export function gridOf(ts: Pick<Tileset, "width" | "height" | "tw" | "th" | "margin" | "spacing">) {
  const cols = Math.max(1, Math.floor((ts.width - 2 * ts.margin + ts.spacing) / (ts.tw + ts.spacing)));
  const rows = Math.max(1, Math.floor((ts.height - 2 * ts.margin + ts.spacing) / (ts.th + ts.spacing)));
  return { cols, rows, count: cols * rows };
}

export function tileOrigin(ts: Tileset, local: number) {
  const { cols } = gridOf(ts);
  return {
    sx: ts.margin + (local % cols) * (ts.tw + ts.spacing),
    sy: ts.margin + Math.floor(local / cols) * (ts.th + ts.spacing),
  };
}
