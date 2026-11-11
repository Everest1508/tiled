import { describe, expect, it } from "vitest";
import { buildCatalog, cleanComps, generationPrompt, normName, variantsPrompt } from "./catalog";
import { streamMessage, parseSse, imageBlock } from "./claude";
import { listModels, streamChat } from "./llm";
import { normalizeProvider } from "./providers";
import { toTmj, toProject, fromProject } from "./exporters";
import { applyVariant, extractJson, fillLayers, newMap, previewCell } from "./mapops";
import { gid, Tileset } from "./types";

const ts = (slot: number, name: string, names: Record<number, string>, comps: any[] = []): Tileset => ({
  id: "t" + slot, slot, name, src: "data:image/png;base64,AAAA", width: 64, height: 32, tw: 16, th: 16,
  margin: 0, spacing: 0, names, comps,
});

const sets = [
  ts(0, "Terrain", { 0: "grass", 1: "water", 2: "grass" /* duplicate */ }),
  ts(1, "Town", { 0: "roof", 5: "wall" }, [{ name: "House", cols: 2, rows: 1, ids: [0, 5] }]),
];

describe("catalog", () => {
  const cat = buildCatalog(sets);
  it("assigns one symbol per unique name across tilesheets", () => {
    expect(cat.entries.map((e) => e.name)).toEqual(["grass", "water", "roof", "wall"]);
    expect(cat.symToGid["c"]).toBe(gid(1, 0));
  });
  it("exposes composites with global ids", () => {
    expect(cat.comps["house"].gids).toEqual([gid(1, 0), gid(1, 5)]);
    expect(cat.text).toContain("house: 2x1 tiles");
  });
  it("normalises names", () => {
    expect(normName("  Road Turn-NE! ")).toBe("road_turn_ne");
  });
  it("validates composites from Claude", () => {
    expect(cleanComps([{ name: "x", cols: 2, rows: 1, ids: [0, 99] }, { name: "ok", cols: 1, rows: 1, ids: [3] }], 8)).toHaveLength(1);
  });
  it("builds prompts", () => {
    expect(generationPrompt(cat, "a village", 8, 4)).toContain("8 columns x 4 rows");
  });
});

describe("map building", () => {
  const cat = buildCatalog(sets);
  it("fills layers and stamps and warns about bad data", () => {
    const warnings: string[] = [];
    const reply = {
      layers: [{ name: "ground", rows: ["aabb", "abZb"] }],
      stamps: [{ layer: "objects", composite: "house", x: 2, y: 1 }, { layer: "objects", composite: "nope", x: 0, y: 0 }],
    };
    const map = fillLayers(newMap(4, 2), reply, cat, warnings);
    expect(map.layers.map((l) => l.name)).toEqual(["ground", "objects"]);
    expect(map.layers[0].cells[0]).toBe(gid(0, 0));
    expect(map.layers[0].cells[6]).toBe(0); // unknown symbol Z left empty
    expect(map.layers[1].cells[1 * 4 + 2]).toBe(gid(1, 0));
    expect(map.layers[1].cells[1 * 4 + 3]).toBe(gid(1, 5));
    expect(warnings.length).toBe(2);
  });
  it("extracts JSON from fenced replies", () => {
    expect(extractJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson("nothing")).toThrow();
  });
  it("applies a variant only inside the region and previews it", () => {
    const map = fillLayers(newMap(4, 4), { layers: [{ name: "ground", rows: ["aaaa", "aaaa", "aaaa", "aaaa"] }] }, cat);
    const variant = { label: "v", map: fillLayers(newMap(2, 2), { layers: [{ name: "ground", rows: ["bb", "bb"] }] }, cat) };
    const region = { x: 1, y: 1, w: 2, h: 2 };
    const { map: out, applied } = applyVariant(map, variant, region);
    expect(applied).toBe(1);
    expect(out.layers[0].cells[0]).toBe(gid(0, 0));
    expect(out.layers[0].cells[1 * 4 + 1]).toBe(gid(0, 1));
    expect(map.layers[0].cells[1 * 4 + 1]).toBe(gid(0, 0)); // original untouched
    expect(previewCell(map, 0, 1, 1, { variant, region })).toBe(gid(0, 1));
    expect(previewCell(map, 0, 0, 0, { variant, region })).toBe(gid(0, 0));
  });
  it("builds a region prompt with context", () => {
    const map = fillLayers(newMap(6, 6), { layers: [{ name: "ground", rows: Array(6).fill("aaaaaa") }] }, cat);
    const p = variantsPrompt(cat, map, { x: 2, y: 2, w: 2, h: 2 }, "market", 3);
    expect(p).toContain("REGION x=2 y=2 width=2 height=2");
    expect(p).toContain('LAYER "ground"');
    expect(p).toContain("WHAT I WANT IN THE REGION: market");
  });
});

describe("export", () => {
  const cat = buildCatalog(sets);
  const map = fillLayers(newMap(2, 1), { layers: [{ name: "g", rows: ["ac"] }] }, cat);
  it("writes tmj with per-tileset firstgid", () => {
    const tmj = toTmj(map, sets);
    expect(tmj.tilesets[0].firstgid).toBe(1);
    expect(tmj.tilesets[1].firstgid).toBe(1 + 8);
    expect(tmj.layers[0].data).toEqual([1, 9]);
    expect(tmj.tilesets[1].tiles).toContainEqual({ id: 5, type: "wall" });
  });
  it("round-trips a project", () => {
    const back = fromProject(JSON.parse(JSON.stringify(toProject("p", 2, sets, map))));
    expect(back.tilesets).toHaveLength(2);
    expect(Array.from(back.map!.layers[0].cells)).toEqual(Array.from(map.layers[0].cells));
  });
});

const sse = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      chunks.forEach((x) => c.enqueue(enc.encode(x)));
      c.close();
    },
  });

describe("claude client", () => {
  it("parses SSE split across chunks", async () => {
    const out: string[] = [];
    for await (const e of parseSse(sse(["event: a\ndata: {\"x\"", ":1}\n\nevent: b\ndata: 2\n\n"]))) out.push(e.event + e.data);
    expect(out).toEqual(['a{"x":1}', "b2"]);
  });
  it("streams text and reports the stop reason", async () => {
    const body = sse([
      'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"{\\"a\\""}}\n\n',
      'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":":1}"}}\n\n',
      'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"}}\n\n',
    ]);
    let seenHeaders: any;
    const fetchImpl = (async (_u: string, init: any) => {
      seenHeaders = init.headers;
      return new Response(body, { status: 200 });
    }) as any;
    const r = await streamMessage({ settings: { apiKey: " k ", model: "m", baseUrl: "" }, system: "s", content: [], maxTokens: 10, fetchImpl });
    expect(r).toEqual({ text: '{"a":1}', stopReason: "end_turn" });
    expect(seenHeaders["x-api-key"]).toBe("k");
    expect(seenHeaders["anthropic-dangerous-direct-browser-access"]).toBe("true");
  });
  it("surfaces API errors and missing keys", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 })) as any;
    await expect(streamMessage({ settings: { apiKey: "k", model: "m", baseUrl: "" }, system: "", content: [], maxTokens: 1, fetchImpl })).rejects.toThrow("bad key");
    await expect(streamMessage({ settings: { apiKey: "", model: "m", baseUrl: "" }, system: "", content: [], maxTokens: 1 })).rejects.toThrow("API key");
  });
  it("converts data URLs to image blocks", () => {
    expect(imageBlock("data:image/png;base64,QQ==")).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "QQ==" } });
  });
});

describe("other AI services", () => {
  const chunks = (parts: string[]) => parts.map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
  const body = (extra = "") => {
    const enc = new TextEncoder();
    const all = [...chunks(['{"a"', ":1}"]), `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}\n\n`, "data: [DONE]\n\n", extra];
    return new ReadableStream<Uint8Array>({ start(c) { all.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } });
  };
  const run = async (provider: string, apiKey = "k") => {
    let url = "", init: any;
    const fetchImpl = (async (u: string, i: any) => { url = u; init = i; return new Response(body(), { status: 200 }); }) as any;
    const r = await streamChat({
      settings: { provider, apiKey, model: "m1", baseUrl: provider === "groq" ? "https://api.groq.com/openai/v1/" : "http://localhost:11434/v1" },
      system: "sys",
      content: [{ type: "text", text: "hi" }, imageBlock("data:image/png;base64,QQ==")],
      maxTokens: 123, fetchImpl,
    });
    return { r, url, payload: JSON.parse(init.body), headers: init.headers };
  };
  it("streams Chat Completions and maps the length stop reason", async () => {
    const { r, url, payload, headers } = await run("groq");
    expect(r).toEqual({ text: '{"a":1}', stopReason: "max_tokens" });
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(headers.authorization).toBe("Bearer k");
    expect(payload.max_tokens).toBe(123);
    expect(payload.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(payload.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,QQ==" } });
  });
  it("uses max_completion_tokens for OpenAI", async () => {
    const { payload } = await run("openai");
    expect(payload.max_completion_tokens).toBe(123);
    expect(payload.max_tokens).toBeUndefined();
  });
  it("lets local servers work without a key", async () => {
    const { headers } = await run("custom", "");
    expect(headers.authorization).toBeUndefined();
  });
  it("asks for a key or model when missing", async () => {
    const base = { provider: "groq", model: "m", baseUrl: "https://x/v1" };
    await expect(streamChat({ settings: { ...base, apiKey: "" }, system: "", content: [], maxTokens: 1 })).rejects.toThrow("API key");
    await expect(streamChat({ settings: { ...base, apiKey: "k", model: " " }, system: "", content: [], maxTokens: 1 })).rejects.toThrow("model");
  });
  it("shows service error messages", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: "no such model" } }), { status: 404 })) as any;
    await expect(streamChat({ settings: { provider: "openai", apiKey: "k", model: "m", baseUrl: "https://x/v1" }, system: "", content: [], maxTokens: 1, fetchImpl })).rejects.toThrow("no such model");
  });
  it("lists models and drops non-chat ones", async () => {
    const fetchImpl = (async (u: string) => {
      expect(u).toBe("https://x/v1/models");
      return new Response(JSON.stringify({ data: [{ id: "b-chat" }, { id: "a-chat" }, { id: "whisper-large" }, { id: "text-embedding-3" }] }), { status: 200 });
    }) as any;
    expect(await listModels({ provider: "openai", apiKey: "k", model: "", baseUrl: "https://x/v1/" }, fetchImpl)).toEqual(["a-chat", "b-chat"]);
  });
  it("keeps old saved settings working", () => {
    expect(normalizeProvider("api")).toBe("anthropic");
    expect(normalizeProvider("bridge")).toBe("bridge");
    expect(normalizeProvider("nonsense")).toBe("anthropic");
  });
});
