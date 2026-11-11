#!/usr/bin/env node
// MCP server (stdio) for Claude Code. Starts the local HTTP bridge the page connects to.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createBridge } from "./bridge.mjs";

const port = Number(process.env.TILE_STUDIO_PORT || 8787);
const origins = (process.env.TILE_STUDIO_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const bridge = createBridge({ port, origins });

let listenError = null;
try {
  await bridge.listen();
  console.error(`[tile-studio] page bridge listening on http://127.0.0.1:${port}`);
} catch (e) {
  listenError = e.message;
  console.error(`[tile-studio] could not open port ${port}: ${e.message}`);
}

const MAP_RULES = `Map JSON format (used by set_map and set_area_options):
{"layers":[{"name":"ground","rows":["aaabb","aabbb"]}],"stamps":[{"layer":"buildings","composite":"house","x":3,"y":2}]}
- Each layer has exactly one string per map row and exactly one character per map column, using the legend symbols from get_catalog; '.' is an empty cell.
- Order layers bottom to top: ground/terrain first, then paths and water edges, then objects such as trees and buildings, then decoration.
- Make the map coherent: terrain transitions use edge/corner tiles when they exist, paths connect, buildings sit on valid ground and face a path, nothing floats.
- Use composites through "stamps" so multi-tile objects stay intact. Never invent symbols or composite names.`;

const server = new McpServer(
  { name: "tile-studio", version: "1.0.0" },
  {
    instructions: `You control Tile Map Studio, a browser tile map editor the user has open. Tilesheets are images split into tiles; tiles get names, and maps are built from named tiles.

Typical flow: studio_status -> get_tileset_image + set_tile_names (name tiles and find multi-tile objects) -> get_catalog -> set_map (create a map) -> set_area_options (alternatives for the area the user selected).
If the user asked you to work through page requests, loop on next_job and finish every job with finish_job.

${MAP_RULES}`,
  },
);

const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
const needSnapshot = () => (bridge.snapshot ? null : text(listenError ? `The page bridge could not start: ${listenError}` : "The page has not shared its project yet. Ask the user to open Tile Map Studio and choose Claude Code in Settings.", true));

const layerShape = z.object({ name: z.string(), rows: z.array(z.string()) });
const stampShape = z.object({ layer: z.string(), composite: z.string(), x: z.number().int(), y: z.number().int() });

server.registerTool("studio_status", {
  title: "Studio status",
  description: "Shows whether the page is connected and summarises tilesheets, the map, the selected area and waiting jobs. Call this first.",
  inputSchema: {},
}, async () => {
  const s = bridge.snapshot;
  return text(JSON.stringify({
    pageConnected: bridge.pageConnected,
    bridgePort: port,
    ...(listenError ? { bridgeError: listenError } : {}),
    sharedAt: s ? new Date(bridge.snapshotAt).toISOString() : null,
    project: s?.projectName ?? null,
    tilesheets: s?.tilesets?.map((t) => ({ name: t.name, tileSize: `${t.tw}x${t.th}`, grid: `${t.cols}x${t.rows}`, tiles: t.count, named: t.named })) ?? [],
    map: s?.map ? { width: s.map.w, height: s.map.h, layers: s.map.layers } : null,
    selectedArea: s?.region ?? null,
    jobs: bridge.jobCounts(),
  }, null, 2));
});

server.registerTool("get_catalog", {
  title: "Get tile legend",
  description: "Returns the legend of named tiles (one symbol per tile) and multi-tile objects (composites) that maps may use.",
  inputSchema: {},
}, async () => needSnapshot() ?? text(bridge.snapshot.catalogText || "No tiles are named yet. Use get_tileset_image and set_tile_names first."));

server.registerTool("get_tileset_image", {
  title: "Look at a tilesheet",
  description: "Returns the tilesheet image with its grid and tile ids drawn on it (ids are row-major from 0, shown in each tile's top-left corner), plus its dimensions. Use it to name tiles.",
  inputSchema: { tileset: z.string().describe("Tilesheet name or id, as listed by studio_status") },
}, async ({ tileset }) => {
  const bad = needSnapshot();
  if (bad) return bad;
  const key = tileset.trim().toLowerCase();
  const t = bridge.snapshot.tilesets.find((x) => x.id === tileset || x.name.toLowerCase() === key);
  if (!t) return text(`No tilesheet called "${tileset}". Available: ${bridge.snapshot.tilesets.map((x) => x.name).join(", ") || "none"}.`, true);
  const m = /^data:([^;]+);base64,(.*)$/.exec(t.annotated || "");
  if (!m) return text("The page has not sent that image yet. Try again in a moment.", true);
  const used = bridge.snapshot.tilesets.filter((x) => x.id !== t.id).flatMap((x) => x.names ?? []);
  return {
    content: [
      { type: "text", text: `Tilesheet "${t.name}": ${t.tw}x${t.th} px tiles, ${t.cols} columns x ${t.rows} rows (${t.count} tiles), ids row-major from 0.${used.length ? ` Names already used on other sheets (do not reuse): ${used.join(", ")}.` : ""}` },
      { type: "image", data: m[2], mimeType: m[1] },
    ],
  };
});

server.registerTool("set_tile_names", {
  title: "Name tiles and objects",
  description: "Names tiles of a tilesheet and defines multi-tile objects. Names are lowercase snake_case and unique across all sheets (grass, road_corner_ne, roof_left). Skip fully transparent tiles. This replaces the sheet's existing names. composites are objects made of adjacent tiles (a house, a tree): ids are row-major tile ids, -1 for an empty cell, and ids.length must equal cols*rows.",
  inputSchema: {
    tileset: z.string(),
    tiles: z.array(z.object({ id: z.number().int().min(0), name: z.string() })),
    composites: z.array(z.object({ name: z.string(), cols: z.number().int().min(1), rows: z.number().int().min(1), ids: z.array(z.number().int()) })).optional(),
  },
}, async (args) => {
  try {
    const r = await bridge.sendCommand("applyNaming", args);
    return text(r.message || (r.ok ? "Done." : "The page rejected the names."), !r.ok);
  } catch (e) {
    return text(e.message, true);
  }
});

server.registerTool("get_map", {
  title: "Read the current map",
  description: "Returns the current map as rows of legend symbols per layer, and the selected area. '?' marks a tile that has no name.",
  inputSchema: {},
}, async () => needSnapshot() ?? text(bridge.snapshot.mapText || "There is no map yet. Use set_map to create one."));

server.registerTool("set_map", {
  title: "Create or replace the map",
  description: `Replaces the whole map. width and height are in tiles (4 to 96). Every layer needs exactly height rows of width characters. Call get_catalog first for the legend and objects. ${MAP_RULES}`,
  inputSchema: {
    width: z.number().int().min(4).max(96),
    height: z.number().int().min(4).max(96),
    layers: z.array(layerShape).min(1),
    stamps: z.array(stampShape).optional(),
  },
}, async (args) => {
  try {
    const r = await bridge.sendCommand("setMap", args);
    return text(r.message || (r.ok ? "Map updated." : "The page could not apply the map."), !r.ok);
  } catch (e) {
    return text(e.message, true);
  }
});

server.registerTool("set_area_options", {
  title: "Offer alternatives for the selected area",
  description: `Shows several alternatives for the area the user selected on the map (see get_map for its position). Each variant contains only the region: layers with exactly region-height rows of region-width characters, and stamps with coordinates relative to the region's top-left. Use the same layer names as the map. The user previews them and picks one. ${MAP_RULES}`,
  inputSchema: {
    variants: z.array(z.object({ label: z.string(), layers: z.array(layerShape), stamps: z.array(stampShape).optional() })).min(1).max(8),
  },
}, async (args) => {
  try {
    const r = await bridge.sendCommand("setVariants", args);
    return text(r.message || (r.ok ? "Options shown." : "The page could not show the options."), !r.ok);
  } catch (e) {
    return text(e.message, true);
  }
});

server.registerTool("next_job", {
  title: "Wait for a request from the page",
  description: "Waits for the user to press a Claude button on the page (name tiles, generate map, area options, refine). Returns the request with what to do, or says no job is waiting. After doing the work with the matching tool, call finish_job. When no job is waiting, call next_job again.",
  inputSchema: { wait_seconds: z.number().int().min(0).max(50).optional().describe("How long to wait, default 30") },
}, async ({ wait_seconds }) => {
  const job = await bridge.nextJob((wait_seconds ?? 30) * 1000);
  if (!job) return text("No job is waiting right now. Call next_job again to keep listening.");
  const how = {
    name_tileset: "Look at the attached image, then call set_tile_names with the tilesheet name given below.",
    generate_map: "Call set_map with the new map.",
    refine_map: "Call set_map with the COMPLETE updated map (all layers).",
    area_options: "Call set_area_options with the requested number of variants.",
  }[job.type] ?? "Do what the request says with the matching tool.";
  const content = [{
    type: "text",
    text: `JOB ${job.id} (${job.type})\n${how}\nWhen finished, call finish_job with id "${job.id}".\n${job.meta?.tileset ? `Tilesheet: ${job.meta.tileset}\n` : ""}\n--- REQUEST ---\n${job.prompt}`,
  }];
  const m = job.image && /^data:([^;]+);base64,(.*)$/.exec(job.image);
  if (m) content.push({ type: "image", data: m[2], mimeType: m[1] });
  return { content };
});

server.registerTool("finish_job", {
  title: "Report a job as finished",
  description: "Tells the page that a job from next_job is done (or failed), so it stops showing 'waiting for Claude Code'.",
  inputSchema: { id: z.string(), message: z.string().optional().describe("Short summary shown to the user"), error: z.string().optional().describe("Set only if the job could not be done") },
}, async ({ id, message, error }) => {
  const r = bridge.finishJob(id, { message, error });
  return text(r.text, !r.ok);
});

server.registerPrompt("work", {
  title: "Serve the Tile Map Studio page",
  description: "Keep picking up requests from the page until told to stop.",
}, () => ({
  messages: [{ role: "user", content: { type: "text", text: "Work as the AI behind Tile Map Studio. Call studio_status, then loop on next_job: do each job with the matching tool (set_tile_names, set_map, set_area_options), call finish_job, and call next_job again. Keep going until I say stop." } }],
}));

await server.connect(new StdioServerTransport());
process.on("SIGINT", () => bridge.close().then(() => process.exit(0)));
