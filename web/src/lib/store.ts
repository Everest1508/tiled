import { useSyncExternalStore } from "react";
import { ClaudeSettings } from "./claude";
import { inArtifact, normalizeProvider, providerInfo, ProviderId } from "./providers";
import { cleanComps, normName } from "./catalog";
import { fromProject, toProject, toTmj, tilesetFileNames } from "./exporters";
import { loadImage, readFileAsDataUrl } from "./images";
import { applyVariant, cloneMap, newLayer, newMap, stampInto, uid } from "./mapops";
import { renderToCanvas } from "./render";
import { Comp, gid, gidSlot, gridOf, MapData, Rect, Tileset, Variant } from "./types";

export type Tool = "paint" | "erase" | "select" | "pan";
export type Panel = "sheets" | "map" | "ai";
export type AiTab = "generate" | "area" | "refine";

export interface Brush {
  cols: number;
  rows: number;
  gids: number[];
  label: string;
}

export interface Settings extends ClaudeSettings {
  remember: boolean;
  /** Which AI service is active. "bridge" hands work to Claude Code through the local MCP bridge. */
  provider: ProviderId;
  bridgeUrl: string;
  /** Key, model and address remembered for each service the user has set up. */
  profiles: Partial<Record<ProviderId, Profile>>;
}

export interface Profile {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export type BridgeStatus = "off" | "connecting" | "connected" | "error";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "ok" | "error";
}

export interface State {
  projectName: string;
  tilesets: Tileset[];
  nextSlot: number;
  activeTilesetId: string | null;
  map: MapData | null;
  mapVersion: number;
  activeLayerId: string | null;
  history: MapData[];
  future: MapData[];
  brush: Brush | null;
  tool: Tool;
  showGrid: boolean;
  region: Rect | null;
  variants: Variant[];
  selVariant: number;
  settings: Settings;
  bridge: BridgeStatus;
  settingsOpen: boolean;
  busy: { label: string; chars: number } | null;
  toast: Toast | null;
  panel: Panel;
  aiTab: AiTab;
  theme: "dark" | "light";
}

const SETTINGS_KEY = "tms.settings.v1";
const THEME_KEY = "tms.theme";

function loadSettings(): Settings {
  const d = providerInfo("anthropic");
  const base: Settings = { apiKey: "", model: d.model, baseUrl: d.baseUrl, remember: false, provider: inArtifact() ? "sample" : "anthropic", bridgeUrl: "http://127.0.0.1:8787", profiles: {} };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const merged: Settings = { ...base, ...saved, provider: normalizeProvider(saved.provider), profiles: saved.profiles ?? {} };
      // Settings saved before multiple providers existed belong to Claude.
      if (!saved.profiles && merged.provider === "anthropic" && !merged.baseUrl) merged.baseUrl = d.baseUrl;
      return merged;
    }
  } catch {
    /* storage unavailable */
  }
  return base;
}

function loadTheme(): "dark" | "light" {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    /* ignore */
  }
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

let state: State = {
  projectName: "Untitled map",
  tilesets: [],
  nextSlot: 0,
  activeTilesetId: null,
  map: null,
  mapVersion: 0,
  activeLayerId: null,
  history: [],
  future: [],
  brush: null,
  tool: "paint",
  showGrid: true,
  region: null,
  variants: [],
  selVariant: -1,
  settings: loadSettings(),
  bridge: "off",
  settingsOpen: false,
  busy: null,
  toast: null,
  panel: "sheets",
  aiTab: "generate",
  theme: loadTheme(),
};

const listeners = new Set<() => void>();
export const getState = () => state;

export function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** True when the chosen AI service has what it needs to work. */
export function isConnected(s: State) {
  const p = s.settings.provider;
  if (p === "bridge") return s.bridge === "connected";
  if (p === "sample") return true;
  return providerInfo(p).needsKey ? !!s.settings.apiKey.trim() : !!s.settings.model.trim() && !!s.settings.baseUrl.trim();
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => selector(state),
  );
}

// ---- Small helpers --------------------------------------------------------

let toastId = 0;
export function notify(text: string, kind: Toast["kind"] = "info") {
  const id = ++toastId;
  setState({ toast: { id, text, kind } });
  setTimeout(() => {
    if (getState().toast?.id === id) setState({ toast: null });
  }, kind === "error" ? 7000 : 3500);
}

function persistSettings(settings: Settings) {
  try {
    // Keys are only written to disk when the user asked to remember them.
    const profiles = Object.fromEntries(Object.entries(settings.profiles).map(([k, p]) => [k, settings.remember ? p : { ...p!, apiKey: "" }]));
    const { apiKey, ...rest } = settings;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...rest, profiles, apiKey: settings.remember ? apiKey : "" }));
  } catch {
    /* ignore */
  }
}

export function setSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  setState({ settings });
  persistSettings(settings);
}

/** Switches the active AI service, keeping what was entered for the one being left. */
export function setProvider(id: ProviderId) {
  const cur = state.settings;
  if (cur.provider === id) return;
  const profiles = { ...cur.profiles };
  if (providerInfo(cur.provider).format !== "bridge") profiles[cur.provider] = { apiKey: cur.apiKey, model: cur.model, baseUrl: cur.baseUrl };
  const info = providerInfo(id);
  const next = profiles[id] ?? { apiKey: "", model: info.model, baseUrl: info.baseUrl };
  const settings: Settings = { ...cur, provider: id, profiles, ...(info.format === "bridge" ? {} : next) };
  setState({ settings });
  persistSettings(settings);
}

export function setTheme(theme: "dark" | "light") {
  setState({ theme });
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

// ---- Tilesheets -----------------------------------------------------------

function guessTileSize(w: number, h: number) {
  for (const s of [16, 32, 8, 24, 48, 64]) if (w % s === 0 && h % s === 0) return s;
  return 16;
}

const uniqueSheetName = (name: string, tilesets: Tileset[]) => {
  let n = name || "Tilesheet";
  for (let i = 2; tilesets.some((t) => t.name === n); i++) n = `${name} ${i}`;
  return n;
};

export async function addTilesetFiles(files: File[]) {
  let tilesets = state.tilesets;
  let nextSlot = state.nextSlot;
  let lastId: string | null = null;
  for (const file of files) {
    try {
      const src = await readFileAsDataUrl(file);
      const ts: Tileset = {
        id: uid(), slot: nextSlot++, name: uniqueSheetName(file.name.replace(/\.[^.]+$/, ""), tilesets), src,
        width: 0, height: 0, tw: 16, th: 16, margin: 0, spacing: 0, names: {}, comps: [],
      };
      const img = await loadImage(ts);
      ts.width = img.naturalWidth;
      ts.height = img.naturalHeight;
      ts.tw = ts.th = guessTileSize(ts.width, ts.height);
      tilesets = [...tilesets, ts];
      lastId = ts.id;
    } catch (e) {
      notify((e as Error).message, "error");
    }
  }
  setState({ tilesets, nextSlot, activeTilesetId: lastId ?? state.activeTilesetId, panel: "sheets" });
  if (lastId) notify(`Added ${files.length > 1 ? "tilesheets" : "tilesheet"}. Check the tile size, then let AI name the tiles.`, "ok");
}

export function updateTileset(id: string, patch: Partial<Tileset>) {
  setState({ tilesets: state.tilesets.map((t) => (t.id === id ? { ...t, ...patch } : t)), mapVersion: state.mapVersion + 1 });
}

export function removeTileset(id: string) {
  const ts = state.tilesets.find((t) => t.id === id);
  if (!ts) return;
  const tilesets = state.tilesets.filter((t) => t.id !== id);
  let map = state.map;
  if (map) {
    map = cloneMap(map);
    for (const l of map.layers) for (let i = 0; i < l.cells.length; i++) if (l.cells[i] && gidSlot(l.cells[i]) === ts.slot) l.cells[i] = 0;
  }
  const brush = state.brush && state.brush.gids.some((g) => g && gidSlot(g) === ts.slot) ? null : state.brush;
  setState({ tilesets, map, brush, activeTilesetId: tilesets[0]?.id ?? null, variants: [], selVariant: -1, mapVersion: state.mapVersion + 1 });
}

function usedNamesElsewhere(tsId: string, local: number | null) {
  const used = new Set<string>();
  for (const t of state.tilesets) {
    for (const [k, n] of Object.entries(t.names)) {
      if (t.id === tsId && local !== null && Number(k) === local) continue;
      used.add(n);
    }
  }
  return used;
}

function uniquify(name: string, used: Set<string>) {
  let n = name;
  for (let i = 2; used.has(n); i++) n = `${name}_${i}`;
  return n;
}

export function setTileName(tsId: string, local: number, raw: string) {
  const name = normName(raw);
  const ts = state.tilesets.find((t) => t.id === tsId);
  if (!ts) return "";
  const names = { ...ts.names };
  let final = "";
  if (name) {
    final = uniquify(name, usedNamesElsewhere(tsId, local));
    names[local] = final;
  } else delete names[local];
  updateTileset(tsId, { names });
  return final;
}

export function addComp(tsId: string, comp: Comp) {
  const ts = state.tilesets.find((t) => t.id === tsId);
  if (!ts) return;
  const name = normName(comp.name);
  updateTileset(tsId, { comps: [...ts.comps.filter((c) => c.name !== name), { ...comp, name }] });
}

export function removeComp(tsId: string, name: string) {
  const ts = state.tilesets.find((t) => t.id === tsId);
  if (ts) updateTileset(tsId, { comps: ts.comps.filter((c) => c.name !== name) });
}

/** Applies Claude's naming reply to one tilesheet. Returns counts for the toast. */
export function applyNaming(tsId: string, reply: any) {
  const ts = state.tilesets.find((t) => t.id === tsId);
  if (!ts) return { named: 0, comps: 0 };
  const { count } = gridOf(ts);
  const used = usedNamesElsewhere(tsId, null);
  // Names from this sheet are replaced, so don't count them as taken.
  const names: Record<number, string> = {};
  for (const t of Array.isArray(reply?.tiles) ? reply.tiles : []) {
    const id = Math.floor(Number(t?.id));
    const name = normName(t?.name);
    if (!name || !(id >= 0 && id < count)) continue;
    const u = uniquify(name, used);
    used.add(u);
    names[id] = u;
  }
  const comps = cleanComps(reply?.composites, count);
  updateTileset(tsId, { names, comps });
  return { named: Object.keys(names).length, comps: comps.length };
}

// ---- Map and history ------------------------------------------------------

const HISTORY_LIMIT = 40;

function pushHistory(prev: MapData | null) {
  if (!prev) return state.history;
  return [...state.history, prev].slice(-HISTORY_LIMIT);
}

/** Replaces the map and records the old one for undo. */
export function commitMap(map: MapData, activeLayerId?: string | null) {
  setState({
    history: pushHistory(state.map),
    future: [],
    map,
    mapVersion: state.mapVersion + 1,
    activeLayerId: activeLayerId ?? (map.layers.find((l) => l.id === state.activeLayerId)?.id ?? map.layers[map.layers.length - 1]?.id ?? null),
  });
}

export function newBlankMap(w: number, h: number) {
  const map = newMap(w, h);
  map.layers.push(newLayer(map, "Ground"), newLayer(map, "Objects"));
  setState({ history: [], future: [], region: null, variants: [], selVariant: -1 });
  commitMap(map, map.layers[0].id);
  setState({ history: [] });
}

export function undo() {
  const prev = state.history[state.history.length - 1];
  if (!prev) return;
  setState({
    history: state.history.slice(0, -1),
    future: state.map ? [state.map, ...state.future] : state.future,
    map: prev,
    mapVersion: state.mapVersion + 1,
    variants: [],
    selVariant: -1,
  });
}

export function redo() {
  const next = state.future[0];
  if (!next) return;
  setState({ future: state.future.slice(1), history: pushHistory(state.map), map: next, mapVersion: state.mapVersion + 1, variants: [], selVariant: -1 });
}

let stroke: { snapshot: MapData; changed: boolean } | null = null;

export function beginStroke() {
  if (state.map) stroke = { snapshot: cloneMap(state.map), changed: false };
}

export function paintAt(x: number, y: number) {
  const { map, activeLayerId, tool, brush } = state;
  if (!map || !stroke) return;
  const layer = map.layers.find((l) => l.id === activeLayerId);
  if (!layer) return;
  let changed = false;
  if (tool === "erase") {
    if (x >= 0 && y >= 0 && x < map.w && y < map.h && layer.cells[y * map.w + x]) {
      layer.cells[y * map.w + x] = 0;
      changed = true;
    }
  } else if (tool === "paint" && brush) {
    changed = stampInto(layer, map, x, y, brush.cols, brush.rows, brush.gids);
  }
  if (changed) {
    stroke.changed = true;
    setState({ mapVersion: state.mapVersion + 1 });
  }
}

export function endStroke() {
  if (stroke?.changed) setState({ history: pushHistory(stroke.snapshot), future: [] });
  stroke = null;
}

export function setActiveLayer(id: string) {
  setState({ activeLayerId: id });
}

export function toggleLayer(id: string) {
  const map = state.map;
  if (!map) return;
  const m = { ...map, layers: map.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)) };
  setState({ map: m, mapVersion: state.mapVersion + 1 });
}

export function renameLayer(id: string, name: string) {
  const map = state.map;
  if (!map || !name.trim()) return;
  setState({ map: { ...map, layers: map.layers.map((l) => (l.id === id ? { ...l, name: name.trim() } : l)) }, mapVersion: state.mapVersion + 1 });
}

export function addLayer() {
  const map = state.map;
  if (!map) return;
  const m = cloneMap(map);
  const layer = newLayer(m, `Layer ${m.layers.length + 1}`);
  m.layers.push(layer);
  commitMap(m, layer.id);
}

export function removeLayer(id: string) {
  const map = state.map;
  if (!map || map.layers.length <= 1) return;
  const m = cloneMap(map);
  m.layers = m.layers.filter((l) => l.id !== id);
  commitMap(m, m.layers[m.layers.length - 1].id);
}

export function moveLayer(id: string, dir: -1 | 1) {
  const map = state.map;
  if (!map) return;
  const i = map.layers.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= map.layers.length) return;
  const m = cloneMap(map);
  [m.layers[i], m.layers[j]] = [m.layers[j], m.layers[i]];
  commitMap(m, id);
}

// ---- Area options ---------------------------------------------------------

export function setRegion(region: Rect | null) {
  setState({ region, variants: [], selVariant: -1 });
}

export function applySelectedVariant() {
  const { map, region, variants, selVariant } = state;
  const v = variants[selVariant];
  if (!map || !region || !v) return;
  const { map: next, applied } = applyVariant(map, v, region);
  if (!applied) {
    notify("That option had no layers matching this map.", "error");
    return;
  }
  commitMap(next);
  setState({ variants: [], selVariant: -1 });
  notify(`Applied "${v.label}". Undo brings the old area back.`, "ok");
}

// ---- Files ----------------------------------------------------------------

async function download(blob: Blob, name: string) {
  // Artifact pages cannot start downloads themselves; the host offers a save prompt instead.
  const host = inArtifact() ? await (window as any).claude.use("downloads").catch(() => null) : null;
  if (host) {
    try {
      await host.save({ filename: name, data: blob });
    } catch (e: any) {
      if (e?.code !== "declined") notify(e?.message || "Could not save the file here.", "error");
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const fileBase = () => normName(state.projectName).replace(/_/g, "-") || "map";

export async function exportTmj() {
  if (!state.map) return;
  const json = JSON.stringify(toTmj(state.map, state.tilesets), null, 1);
  await download(new Blob([json], { type: "application/json" }), inArtifact() ? `${fileBase()}.map.json` : `${fileBase()}.tmj`);
  const files = tilesetFileNames(state.tilesets);
  notify(`Exported. Keep ${files.join(", ")} next to the map file when you open it in Tiled.`, "ok");
}

export async function exportTilesetImages() {
  const files = tilesetFileNames(state.tilesets);
  for (const [i, t] of state.tilesets.entries()) {
    const bin = atob(t.src.split(",")[1] ?? "");
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    await download(new Blob([bytes], { type: "image/png" }), files[i]);
  }
}

export function exportPng() {
  if (!state.map) return;
  const ts = state.tilesets[0];
  const cell = ts ? Math.max(ts.tw, 16) : 16;
  const cv = renderToCanvas(state.map, state.tilesets, cell);
  cv.toBlob((b) => b && download(b, `${fileBase()}.png`), "image/png");
}

export async function saveProject() {
  const json = JSON.stringify(toProject(state.projectName, state.nextSlot, state.tilesets, state.map));
  await download(new Blob([json], { type: "application/json" }), `${fileBase()}.tilemapstudio.json`);
}

export async function openProject(file: File) {
  try {
    const p = fromProject(JSON.parse(await file.text()));
    await Promise.all(p.tilesets.map((t) => loadImage(t)));
    setState({
      projectName: p.name, tilesets: p.tilesets, nextSlot: p.nextSlot, activeTilesetId: p.tilesets[0]?.id ?? null,
      map: p.map, activeLayerId: p.map?.layers[p.map.layers.length - 1]?.id ?? null, history: [], future: [],
      region: null, variants: [], selVariant: -1, brush: null, mapVersion: state.mapVersion + 1,
    });
    notify("Project opened.", "ok");
  } catch (e) {
    notify((e as Error).message || "Could not open that file.", "error");
  }
}

export const brushFromTile = (ts: Tileset, local: number): Brush => ({ cols: 1, rows: 1, gids: [gid(ts.slot, local)], label: ts.names[local] ?? `tile ${local}` });

export const brushFromComp = (ts: Tileset, c: Comp): Brush => ({
  cols: c.cols, rows: c.rows, gids: c.ids.map((id) => (id >= 0 ? gid(ts.slot, id) : 0)), label: c.name,
});

/** Block of tiles from a tilesheet selection, used as a brush. */
export function brushFromBlock(ts: Tileset, c0: number, r0: number, c1: number, r1: number): Brush {
  const { cols, rows } = gridOf(ts);
  const x0 = Math.max(0, Math.min(c0, c1)), x1 = Math.min(cols - 1, Math.max(c0, c1));
  const y0 = Math.max(0, Math.min(r0, r1)), y1 = Math.min(rows - 1, Math.max(r0, r1));
  const gids: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) gids.push(gid(ts.slot, y * cols + x));
  return { cols: x1 - x0 + 1, rows: y1 - y0 + 1, gids, label: gids.length === 1 ? ts.names[y0 * cols + x0] ?? `tile ${y0 * cols + x0}` : `${x1 - x0 + 1}×${y1 - y0 + 1} block` };
}
