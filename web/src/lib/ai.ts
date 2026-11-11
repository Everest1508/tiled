import { annotatedTilesetImage, selectionImage } from "./annotate";
import { buildCatalog, generationPrompt, namingPrompt, normName, refinePrompt, selectionNamePrompt, SYSTEM_MAP, variantsPrompt } from "./catalog";
import { imageBlock, streamMessage, textBlock } from "./claude";
import { cloneMap, extractJson, fillLayers, newMap, mapIsEmpty } from "./mapops";
import { applyNaming, commitMap, getState, notify, setState } from "./store";
import { gridOf, Rect, Variant } from "./types";

let controller: AbortController | null = null;

export function cancelAi() {
  controller?.abort();
}

/** Runs an AI job with progress, cancel and error handling. Returns undefined on failure. */
async function run<T>(label: string, job: (signal: AbortSignal, progress: (chars: number) => void) => Promise<T>): Promise<T | undefined> {
  if (getState().busy) return undefined;
  controller = new AbortController();
  setState({ busy: { label, chars: 0 } });
  try {
    return await job(controller.signal, (chars) => setState({ busy: { label, chars } }));
  } catch (e) {
    if ((e as Error).name === "AbortError") notify("Cancelled.");
    else {
      const msg = (e as Error).message || "Something went wrong.";
      notify(msg, "error");
      if (/API key/i.test(msg)) setState({ settingsOpen: true });
    }
    return undefined;
  } finally {
    controller = null;
    setState({ busy: null });
  }
}

async function ask(system: string, content: Parameters<typeof streamMessage>[0]["content"], maxTokens: number, signal: AbortSignal, progress: (n: number) => void) {
  const r = await streamMessage({ settings: getState().settings, system, content, maxTokens, signal, onProgress: progress });
  if (r.stopReason === "max_tokens") throw new Error("The reply was cut off because it was too large. Try a smaller map or area.");
  return r.text;
}

const needNames = () => {
  const cat = buildCatalog(getState().tilesets);
  if (cat.empty) {
    notify("Name some tiles first. Open a tilesheet and use \"Name with Claude\".", "error");
    return null;
  }
  return cat;
};

export async function nameTilesetWithClaude(tsId: string, hint: string) {
  const ts = getState().tilesets.find((t) => t.id === tsId);
  if (!ts) return;
  await run(`Claude is studying "${ts.name}"…`, async (signal, progress) => {
    const { cols, rows, count } = gridOf(ts);
    const used = getState().tilesets.filter((t) => t.id !== tsId).flatMap((t) => Object.values(t.names));
    const image = await annotatedTilesetImage(ts);
    const text = await ask(
      "You label tiles of 2D game tilesets precisely. Reply with JSON only.",
      [imageBlock(image), textBlock(namingPrompt(ts, cols, rows, count, hint, used))],
      16000, signal, progress,
    );
    const { named, comps } = applyNaming(tsId, extractJson(text));
    notify(`Named ${named} tiles and found ${comps} objects. Check the names, then generate a map.`, "ok");
  });
}

export async function nameSelectionWithClaude(tsId: string, c0: number, r0: number, c1: number, r1: number): Promise<string | undefined> {
  const ts = getState().tilesets.find((t) => t.id === tsId);
  if (!ts) return undefined;
  return run("Claude is looking at your selection…", async (signal, progress) => {
    const image = await selectionImage(ts, c0, r0, c1, r1);
    const text = await ask(
      "You name pieces of 2D game tilesets. Reply with JSON only.",
      [imageBlock(image), textBlock(selectionNamePrompt(c1 - c0 + 1, r1 - r0 + 1))],
      200, signal, progress,
    );
    return normName(extractJson(text).name);
  });
}

export async function generateMapWithClaude(description: string, w: number, h: number) {
  const cat = needNames();
  if (!cat) return;
  await run(`Claude is designing a ${w} × ${h} map…`, async (signal, progress) => {
    const maxTokens = Math.min(32000, 3000 + w * h * 5);
    const text = await ask(SYSTEM_MAP, [textBlock(generationPrompt(cat, description, w, h))], maxTokens, signal, progress);
    const warnings: string[] = [];
    const map = fillLayers(newMap(w, h), extractJson(text), cat, warnings);
    if (!map.layers.length || mapIsEmpty(map)) throw new Error("Claude returned an empty map. Try again or describe it differently.");
    commitMap(map, map.layers[0].id);
    setState({ region: null, variants: [], selVariant: -1, panel: "map" });
    notify(warnings.length ? `Map ready (${warnings.length} small issues, e.g. ${warnings[0]}).` : "Map ready. Draw on it, or select an area to get options.", warnings.length ? "info" : "ok");
  });
}

export async function generateVariantsWithClaude(description: string, count: number) {
  const { map, region } = getState();
  const cat = needNames();
  if (!cat || !map || !region) return;
  await run(`Claude is designing ${count} options…`, async (signal, progress) => {
    const maxTokens = Math.min(32000, 3000 + count * region.w * region.h * 4 * Math.max(1, map.layers.length));
    const text = await ask(SYSTEM_MAP, [textBlock(variantsPrompt(cat, map, region, description, count))], maxTokens, signal, progress);
    const reply = extractJson(text);
    const variants: Variant[] = (Array.isArray(reply.variants) ? reply.variants : []).map((v: any, i: number) => ({
      label: String(v?.label || `Option ${i + 1}`),
      map: fillLayers(newMap(region.w, region.h), v, cat),
    }));
    if (!variants.length) throw new Error("Claude returned no options. Try again.");
    setState({ variants, selVariant: 0 });
    notify(`${variants.length} options ready. Tap one to preview it on the map.`, "ok");
  });
}

export async function refineMapWithClaude(instruction: string) {
  const { map } = getState();
  const cat = needNames();
  if (!cat || !map) return;
  await run("Claude is changing the map…", async (signal, progress) => {
    const maxTokens = Math.min(32000, 3000 + map.w * map.h * 5);
    const text = await ask(SYSTEM_MAP, [textBlock(refinePrompt(cat, map, instruction))], maxTokens, signal, progress);
    const warnings: string[] = [];
    const next = fillLayers(newMap(map.w, map.h), extractJson(text), cat, warnings);
    if (!next.layers.length || mapIsEmpty(next)) throw new Error("Claude returned an empty map. Try again.");
    // Keep the editor's layer ids and visibility where names match.
    const old = cloneMap(map);
    for (const l of next.layers) {
      const prev = old.layers.find((o) => o.name === l.name);
      if (prev) {
        l.id = prev.id;
        l.visible = prev.visible;
      }
    }
    commitMap(next);
    setState({ region: null, variants: [], selVariant: -1 });
    notify("Map updated. Undo restores the previous version.", "ok");
  });
}

export function regionLabel(r: Rect | null) {
  return r ? `x ${r.x}, y ${r.y} · ${r.w} × ${r.h} tiles` : "No area selected";
}
