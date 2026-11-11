import { annotatedTilesetImage, selectionImage } from "./annotate";
import { buildCatalog, generationPrompt, namingPrompt, normName, refinePrompt, selectionNamePrompt, SYSTEM_MAP, variantsPrompt } from "./catalog";
import { imageBlock, textBlock } from "./claude";
import { streamChat } from "./llm";
import { applyGeneratedMap, applyRefinedMap, applyVariantsReply } from "./apply";
import { runBridgeJob, cancelBridgeJob, usingBridge } from "./bridge";
import { extractJson } from "./mapops";
import { applyNaming, getState, notify, setState } from "./store";
import { gridOf, Rect } from "./types";

let controller: AbortController | null = null;

export function cancelAi() {
  controller?.abort();
  cancelBridgeJob();
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
      if (/API key|model in Settings|base URL in Settings/i.test(msg)) setState({ settingsOpen: true });
    }
    return undefined;
  } finally {
    controller = null;
    setState({ busy: null });
  }
}

async function ask(system: string, content: Parameters<typeof streamChat>[0]["content"], maxTokens: number, signal: AbortSignal, progress: (n: number) => void) {
  const r = await streamChat({ settings: getState().settings, system, content, maxTokens, signal, onProgress: progress });
  if (r.stopReason === "max_tokens") throw new Error("The reply was cut off because it was too large. Try a smaller map or area, or a model with a larger output limit.");
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
  if (usingBridge()) {
    const { cols, rows, count } = gridOf(ts);
    const used = getState().tilesets.filter((t) => t.id !== tsId).flatMap((t) => Object.values(t.names));
    await runBridgeJob({
      type: "name_tileset",
      label: `Claude Code is studying "${ts.name}"…`,
      prompt: namingPrompt(ts, cols, rows, count, hint, used),
      image: await annotatedTilesetImage(ts),
      meta: { tileset: ts.name },
    });
    return;
  }
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
  if (usingBridge()) {
    notify("Suggesting a name for a selection needs the API key mode. Type a name, or use Name with Claude for the whole sheet.", "info");
    return undefined;
  }
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
  if (usingBridge()) {
    await runBridgeJob({ type: "generate_map", label: `Claude Code is designing a ${w} × ${h} map…`, prompt: `Create a map with set_map using width ${w} and height ${h}.\n\n${generationPrompt(cat, description, w, h)}` });
    return;
  }
  await run(`Claude is designing a ${w} × ${h} map…`, async (signal, progress) => {
    const maxTokens = Math.min(32000, 3000 + w * h * 5);
    const text = await ask(SYSTEM_MAP, [textBlock(generationPrompt(cat, description, w, h))], maxTokens, signal, progress);
    applyGeneratedMap(extractJson(text), w, h);
  });
}

export async function generateVariantsWithClaude(description: string, count: number) {
  const { map, region } = getState();
  const cat = needNames();
  if (!cat || !map || !region) return;
  if (usingBridge()) {
    await runBridgeJob({ type: "area_options", label: `Claude Code is designing ${count} options…`, prompt: `Provide exactly ${count} variants with set_area_options.\n\n${variantsPrompt(cat, map, region, description, count)}` });
    return;
  }
  await run(`Claude is designing ${count} options…`, async (signal, progress) => {
    const maxTokens = Math.min(32000, 3000 + count * region.w * region.h * 4 * Math.max(1, map.layers.length));
    const text = await ask(SYSTEM_MAP, [textBlock(variantsPrompt(cat, map, region, description, count))], maxTokens, signal, progress);
    applyVariantsReply(extractJson(text));
  });
}

export async function refineMapWithClaude(instruction: string) {
  const { map } = getState();
  const cat = needNames();
  if (!cat || !map) return;
  if (usingBridge()) {
    await runBridgeJob({ type: "refine_map", label: "Claude Code is changing the map…", prompt: `Call set_map with width ${map.w} and height ${map.h} and the COMPLETE updated map.\n\n${refinePrompt(cat, map, instruction)}` });
    return;
  }
  await run("Claude is changing the map…", async (signal, progress) => {
    const maxTokens = Math.min(32000, 3000 + map.w * map.h * 5);
    const text = await ask(SYSTEM_MAP, [textBlock(refinePrompt(cat, map, instruction))], maxTokens, signal, progress);
    applyRefinedMap(extractJson(text));
  });
}

export function regionLabel(r: Rect | null) {
  return r ? `x ${r.x}, y ${r.y} · ${r.w} × ${r.h} tiles` : "No area selected";
}
