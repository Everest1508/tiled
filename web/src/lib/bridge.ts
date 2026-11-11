// Client for the local Claude Code bridge (bridge/server.mjs). The page keeps an event stream open,
// shares its project state, queues jobs for Claude Code and carries out the commands Claude Code sends back.
import { annotatedTilesetImage } from "./annotate";
import { applyGeneratedMap, applyRefinedMap, applyVariantsReply } from "./apply";
import { buildCatalog, layerRows } from "./catalog";
import { applyNaming, getState, notify, setState, subscribe } from "./store";
import { gridOf, Tileset } from "./types";

export const usingBridge = () => getState().settings.provider === "bridge";

let source: EventSource | null = null;
let connectedUrl = "";
let unsubscribe: (() => void) | null = null;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let lastSig: unknown[] = [];
/** Image keys the bridge already has; cleared whenever the stream (re)connects. */
const sentImages = new Map<string, string>();

const base = () => getState().settings.bridgeUrl.replace(/\/+$/, "");

async function post(path: string, body: unknown, signal?: AbortSignal) {
  const res = await fetch(base() + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Bridge answered ${res.status}`);
  return res.json();
}

export async function checkBridge(url = base()): Promise<{ ok: boolean; text: string }> {
  try {
    const res = await fetch(url.replace(/\/+$/, "") + "/health");
    const j = await res.json();
    if (!j?.ok) throw new Error();
    return { ok: true, text: j.pageConnected ? "Bridge is running and this page is connected." : "Bridge is running. Connecting this page…" };
  } catch {
    return { ok: false, text: "Could not reach the bridge. Start Claude Code with the tile-studio MCP server, and check the address (and that your browser allows this page to reach local devices)." };
  }
}

// ---- state sharing --------------------------------------------------------

function imgKey(t: Tileset) {
  return `${t.src.length}:${t.tw}x${t.th}:${t.margin}:${t.spacing}`;
}

async function buildSnapshot() {
  const s = getState();
  const cat = buildCatalog(s.tilesets);
  const tilesets = [];
  for (const t of s.tilesets) {
    const { cols, rows, count } = gridOf(t);
    const key = imgKey(t);
    const entry: Record<string, unknown> = {
      id: t.id, name: t.name, tw: t.tw, th: t.th, cols, rows, count,
      named: Object.keys(t.names).length, names: Object.values(t.names), imgKey: key,
    };
    if (sentImages.get(t.id) !== key) {
      try {
        entry.annotated = await annotatedTilesetImage(t);
        sentImages.set(t.id, key);
      } catch {
        /* image not decodable yet; retried on next change */
      }
    }
    tilesets.push(entry);
  }
  let mapText = "";
  if (s.map) {
    mapText = `Map ${s.map.w} columns x ${s.map.h} rows. Layers bottom to top:\n` + layerRows(s.map, cat, { x: 0, y: 0, w: s.map.w, h: s.map.h });
    mapText += s.region ? `\nSELECTED AREA: x=${s.region.x} y=${s.region.y} width=${s.region.w} height=${s.region.h}\n` : "\nNo area is selected.\n";
  }
  return {
    projectName: s.projectName,
    tilesets,
    map: s.map ? { w: s.map.w, h: s.map.h, layers: s.map.layers.map((l) => l.name) } : null,
    region: s.region,
    catalogText: cat.empty ? "" : cat.text,
    mapText,
  };
}

async function syncNow() {
  if (getState().bridge !== "connected") return;
  try {
    await post("/state", await buildSnapshot());
  } catch {
    /* the stream will report a lost connection */
  }
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 500);
}

// ---- commands from Claude Code -------------------------------------------

function findTileset(ref: string) {
  const key = String(ref ?? "").trim().toLowerCase();
  const list = getState().tilesets;
  return list.find((t) => t.id === ref) ?? list.find((t) => t.name.toLowerCase() === key) ?? (list.length === 1 ? list[0] : undefined);
}

function handleCommand(type: string, p: any): { ok: boolean; message: string } {
  try {
    if (type === "applyNaming") {
      const ts = findTileset(p.tileset);
      if (!ts) return { ok: false, message: `No tilesheet called "${p.tileset}". Available: ${getState().tilesets.map((t) => t.name).join(", ") || "none"}.` };
      const { named, comps } = applyNaming(ts.id, { tiles: p.tiles, composites: p.composites });
      const message = `Named ${named} tiles and ${comps} objects on "${ts.name}".`;
      notify(`Claude Code: ${message}`, "ok");
      return { ok: named > 0, message: named > 0 ? message : "No valid tile names were found. Check the ids." };
    }
    if (type === "setMap") {
      const map = getState().map;
      const w = Math.floor(Number(p.width));
      const h = Math.floor(Number(p.height));
      const message = map && map.w === w && map.h === h ? applyRefinedMap(p) : applyGeneratedMap(p, w, h);
      return { ok: true, message };
    }
    if (type === "setVariants") {
      return { ok: true, message: applyVariantsReply(p) };
    }
    return { ok: false, message: `Unknown command ${type}.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ---- jobs -----------------------------------------------------------------

interface ActiveJob {
  id: string;
  settle: () => void;
}
let active: ActiveJob | null = null;
const early = new Map<string, any>(); // job updates that arrive before the POST returns

function onJobUpdate(u: { id: string; status: string; message: string }) {
  if (!active || active.id !== u.id) {
    if (!active) early.set(u.id, u);
    return;
  }
  if (u.status === "queued") return;
  if (u.status === "running") {
    const b = getState().busy;
    if (b) setState({ busy: { ...b, chars: 1 } }); // chars > 0 tells the busy bar that Claude Code picked the job up
    return;
  }
  const job = active;
  active = null;
  job.settle();
  if (u.status === "failed") notify(`Claude Code: ${u.message || "the job failed."}`, "error");
  else if (u.status === "done") notify(u.message ? `Claude Code: ${u.message}` : "Claude Code finished.", "ok");
}

export async function runBridgeJob(job: { type: string; label: string; prompt: string; image?: string; meta?: Record<string, unknown> }) {
  if (getState().busy) return;
  if (getState().bridge !== "connected") {
    notify("Claude Code is not connected. Start it with the tile-studio MCP server, then try again.", "error");
    setState({ settingsOpen: true });
    return;
  }
  await syncNow();
  setState({ busy: { label: job.label, chars: 0 } });
  try {
    const { id } = await post("/jobs", job);
    await new Promise<void>((resolve) => {
      active = { id, settle: resolve };
      const e = early.get(id);
      early.clear();
      if (e) onJobUpdate(e);
      notify("Sent to Claude Code. Ask it to run next_job (or use /tile-studio) to pick this up.", "info");
    });
  } catch (e) {
    active = null;
    notify((e as Error).message || "Could not send the job to Claude Code.", "error");
  } finally {
    setState({ busy: null });
  }
}

export function cancelBridgeJob() {
  if (!active) return;
  const job = active;
  active = null;
  post(`/jobs/${job.id}/cancel`, {}).catch(() => {});
  job.settle();
  notify("Cancelled.");
}

// ---- connection -------------------------------------------------------------

function stop() {
  source?.close();
  source = null;
  connectedUrl = "";
  unsubscribe?.();
  unsubscribe = null;
  clearTimeout(syncTimer);
  sentImages.clear();
  setState({ bridge: "off" });
}

function start() {
  const url = base();
  connectedUrl = url;
  setState({ bridge: "connecting" });
  let es: EventSource;
  try {
    es = new EventSource(url + "/events");
  } catch {
    setState({ bridge: "error" });
    return;
  }
  source = es;
  es.addEventListener("hello", () => {
    sentImages.clear();
    setState({ bridge: "connected" });
    syncNow();
  });
  es.addEventListener("command", (ev) => {
    const { id, type, payload } = JSON.parse((ev as MessageEvent).data);
    const result = handleCommand(type, payload);
    post(`/commands/${id}/result`, result).catch(() => {});
  });
  es.addEventListener("job_update", (ev) => onJobUpdate(JSON.parse((ev as MessageEvent).data)));
  es.onerror = () => setState({ bridge: es.readyState === EventSource.CLOSED ? "error" : "connecting" });
  unsubscribe = subscribe(() => {
    const s = getState();
    const sig = [s.tilesets, s.map, s.mapVersion, s.region, s.projectName];
    if (sig.some((v, i) => v !== lastSig[i])) {
      lastSig = sig;
      scheduleSync();
    }
  });
}

/** Opens or closes the connection to match the settings. Call after settings change and on startup. */
export function applyBridgeSettings() {
  const wanted = usingBridge();
  const url = base();
  if (!wanted) {
    if (source || getState().bridge !== "off") stop();
    return;
  }
  if (source && connectedUrl === url) return;
  if (source) stop();
  start();
}
