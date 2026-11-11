// Turns Claude's map JSON into editor changes. Shared by the API path and the Claude Code bridge.
import { buildCatalog } from "./catalog";
import { cloneMap, fillLayers, mapIsEmpty, newMap } from "./mapops";
import { commitMap, getState, notify, setState } from "./store";
import { Variant } from "./types";

export function catalogOrThrow() {
  const cat = buildCatalog(getState().tilesets);
  if (cat.empty) throw new Error("No tiles are named yet. Name some tiles first.");
  return cat;
}

export function applyGeneratedMap(reply: any, w: number, h: number) {
  const cat = catalogOrThrow();
  const warnings: string[] = [];
  const map = fillLayers(newMap(w, h), reply, cat, warnings);
  if (!map.layers.length || mapIsEmpty(map)) throw new Error("The map came back empty. Try again or describe it differently.");
  commitMap(map, map.layers[0].id);
  setState({ region: null, variants: [], selVariant: -1, panel: "map" });
  const text = warnings.length ? `Map ready (${warnings.length} small issues, e.g. ${warnings[0]}).` : "Map ready. Draw on it, or select an area to get options.";
  notify(text, warnings.length ? "info" : "ok");
  return text;
}

export function applyRefinedMap(reply: any) {
  const { map } = getState();
  if (!map) throw new Error("There is no map to change.");
  const cat = catalogOrThrow();
  const warnings: string[] = [];
  const next = fillLayers(newMap(map.w, map.h), reply, cat, warnings);
  if (!next.layers.length || mapIsEmpty(next)) throw new Error("The map came back empty. Try again.");
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
  return warnings.length ? `Map updated (${warnings.length} small issues, e.g. ${warnings[0]}).` : "Map updated.";
}

export function applyVariantsReply(reply: any) {
  const { region } = getState();
  if (!region) throw new Error("No area is selected on the map. Ask the user to select one.");
  const cat = catalogOrThrow();
  const variants: Variant[] = (Array.isArray(reply?.variants) ? reply.variants : []).map((v: any, i: number) => ({
    label: String(v?.label || `Option ${i + 1}`),
    map: fillLayers(newMap(region.w, region.h), v, cat),
  }));
  if (!variants.length) throw new Error("No options were returned. Try again.");
  setState({ variants, selVariant: 0, aiTab: "area" });
  const text = `${variants.length} options ready. Tap one to preview it on the map.`;
  notify(text, "ok");
  return text;
}
