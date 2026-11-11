import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const PORT = 18787;
const URL_ = `http://127.0.0.1:${PORT}`;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Minimal page: reads the SSE stream and answers commands like the real page does. */
async function fakePage(onCommand) {
  const ctrl = new AbortController();
  const res = await fetch(`${URL_}/events`, { signal: ctrl.signal });
  const events = [];
  (async () => {
    const dec = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /event: (.*)/.exec(block)?.[1];
          const data = /data: (.*)/.exec(block)?.[1];
          if (!ev || !data) continue;
          const d = JSON.parse(data);
          events.push({ ev, d });
          if (ev === "command") {
            const r = onCommand(d.type, d.payload);
            await fetch(`${URL_}/commands/${d.id}/result`, { method: "POST", body: JSON.stringify(r) });
          }
        }
      }
    } catch {}
  })();
  return { events, close: () => ctrl.abort() };
}

const waitFor = async (fn) => {
  for (let i = 0; i < 40; i++) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};
const post = (path, body, headers = {}) => fetch(URL_ + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const textOf = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

test("MCP server and page bridge work together", async () => {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../server.mjs", import.meta.url))],
    env: { ...process.env, TILE_STUDIO_PORT: String(PORT), TILE_STUDIO_ORIGINS: "https://studio.example" },
    stderr: "ignore",
  }));

  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ["finish_job", "get_catalog", "get_map", "get_tileset_image", "next_job", "set_area_options", "set_map", "set_tile_names", "studio_status"]);

  // not connected yet
  let r = await client.callTool({ name: "set_map", arguments: { width: 4, height: 4, layers: [{ name: "g", rows: ["....", "....", "....", "...."] }] } });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /not connected/i);
  r = await client.callTool({ name: "get_catalog", arguments: {} });
  assert.equal(r.isError, true);

  // origin rules
  assert.equal((await fetch(`${URL_}/health`, { headers: { origin: "https://evil.example" } })).status, 403);
  const ok = await fetch(`${URL_}/health`, { headers: { origin: "https://studio.example" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://studio.example");
  const pre = await fetch(`${URL_}/state`, { method: "OPTIONS", headers: { origin: "http://localhost:5173" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-private-network"), "true");

  const commands = [];
  const page = await fakePage((type, payload) => {
    commands.push({ type, payload });
    return { ok: true, message: `ok ${type}` };
  });
  await new Promise((r) => setTimeout(r, 100));

  // page shares its state; the image is only sent once
  const snap = (withImage) => ({
    projectName: "Demo",
    tilesets: [{ id: "t1", name: "Town", tw: 16, th: 16, cols: 4, rows: 4, count: 16, named: 2, names: ["grass", "road"], imgKey: "k1", ...(withImage ? { annotated: `data:image/png;base64,${PNG}` } : {}) }],
    map: { w: 4, h: 4, layers: ["ground"] },
    region: { x: 1, y: 1, w: 2, h: 2 },
    catalogText: "TILE LEGEND:\na = grass\nb = road\n. = empty\n",
    mapText: "Map 4 columns x 4 rows.\nLAYER \"ground\":\naaaa\n",
  });
  await post("/state", snap(true));
  await post("/state", snap(false));

  const status = JSON.parse(textOf(await client.callTool({ name: "studio_status", arguments: {} })));
  assert.equal(status.pageConnected, true);
  assert.equal(status.tilesheets[0].name, "Town");
  assert.deepEqual(status.selectedArea, { x: 1, y: 1, w: 2, h: 2 });

  assert.match(textOf(await client.callTool({ name: "get_catalog", arguments: {} })), /a = grass/);
  assert.match(textOf(await client.callTool({ name: "get_map", arguments: {} })), /LAYER "ground"/);

  r = await client.callTool({ name: "get_tileset_image", arguments: { tileset: "town" } });
  assert.equal(r.content.find((c) => c.type === "image").data, PNG);
  r = await client.callTool({ name: "get_tileset_image", arguments: { tileset: "nope" } });
  assert.equal(r.isError, true);

  // Claude drives the page
  r = await client.callTool({ name: "set_tile_names", arguments: { tileset: "Town", tiles: [{ id: 0, name: "grass" }] } });
  assert.equal(textOf(r), "ok applyNaming");
  r = await client.callTool({ name: "set_map", arguments: { width: 4, height: 4, layers: [{ name: "ground", rows: ["aaaa", "aaaa", "aaaa", "aaaa"] }] } });
  assert.equal(textOf(r), "ok setMap");
  r = await client.callTool({ name: "set_area_options", arguments: { variants: [{ label: "A", layers: [{ name: "ground", rows: ["bb", "bb"] }] }] } });
  assert.equal(textOf(r), "ok setVariants");
  assert.deepEqual(commands.map((c) => c.type), ["applyNaming", "setMap", "setVariants"]);
  assert.equal(commands[1].payload.width, 4);

  // invalid input is rejected before reaching the page
  r = await client.callTool({ name: "set_map", arguments: { width: 1, height: 4, layers: [] } });
  assert.equal(r.isError, true);

  // page queues a job, Claude Code picks it up and finishes it
  r = await client.callTool({ name: "next_job", arguments: { wait_seconds: 0 } });
  assert.match(textOf(r), /No job is waiting/);
  const { id } = await (await post("/jobs", { type: "name_tileset", prompt: "NAME IT", image: `data:image/png;base64,${PNG}`, meta: { tileset: "Town" } })).json();
  r = await client.callTool({ name: "next_job", arguments: { wait_seconds: 2 } });
  assert.match(textOf(r), new RegExp(`JOB ${id}`));
  assert.match(textOf(r), /NAME IT/);
  assert.match(textOf(r), /Tilesheet: Town/);
  assert.ok(r.content.some((c) => c.type === "image"));
  assert.ok(await waitFor(() => page.events.some((e) => e.ev === "job_update" && e.d.id === id && e.d.status === "running")));
  r = await client.callTool({ name: "finish_job", arguments: { id, message: "Named 12 tiles" } });
  assert.equal(r.isError, undefined);
  assert.ok(await waitFor(() => page.events.some((e) => e.ev === "job_update" && e.d.id === id && e.d.status === "done" && e.d.message === "Named 12 tiles")));

  // cancel before pickup
  const j2 = await (await post("/jobs", { type: "generate_map", prompt: "X" })).json();
  await post(`/jobs/${j2.id}/cancel`, {});
  r = await client.callTool({ name: "next_job", arguments: { wait_seconds: 0 } });
  assert.match(textOf(r), /No job is waiting/);

  // cancel while Claude Code is working
  const j3 = await (await post("/jobs", { type: "generate_map", prompt: "Y" })).json();
  await client.callTool({ name: "next_job", arguments: { wait_seconds: 1 } });
  await post(`/jobs/${j3.id}/cancel`, {});
  r = await client.callTool({ name: "finish_job", arguments: { id: j3.id } });
  assert.match(textOf(r), /cancelled/);

  page.close();
  await client.close();
});
