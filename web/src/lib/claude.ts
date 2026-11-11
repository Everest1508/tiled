export interface ClaudeSettings {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export const textBlock = (text: string): ContentBlock => ({ type: "text", text });

export function imageBlock(dataUrl: string): ContentBlock {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error("Image must be a base64 data URL");
  return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
}

export class ClaudeError extends Error {}

export interface StreamOptions {
  settings: ClaudeSettings;
  system: string;
  content: ContentBlock[];
  maxTokens: number;
  signal?: AbortSignal;
  /** Called with the number of characters received so far. */
  onProgress?: (chars: number) => void;
  fetchImpl?: typeof fetch;
}

export interface StreamResult {
  text: string;
  stopReason: string | null;
}

export const DEFAULT_BASE_URL = "https://api.anthropic.com";

export const MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (balanced)" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (best quality)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest)" },
];

function endpoint(baseUrl: string) {
  return `${(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")}/v1/messages`;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const msg = body?.error?.message;
    if (msg) return `${msg} (${res.status})`;
  } catch {
    /* ignore */
  }
  if (res.status === 401) return "The API key was rejected (401).";
  if (res.status === 429) return "Rate limited by the API (429). Wait a moment and try again.";
  return `Request failed with status ${res.status}.`;
}

/** Parses a server-sent-events text stream and yields {event, data} objects. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
      let event = "message";
      const data: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) yield { event, data: data.join("\n") };
    }
  }
}

export async function streamMessage(opts: StreamOptions): Promise<StreamResult> {
  const { settings, system, content, maxTokens, signal, onProgress } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  if (!settings.apiKey.trim()) throw new ClaudeError("Add your Claude API key in Settings first.");

  let res: Response;
  try {
    res = await doFetch(endpoint(settings.baseUrl), {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.apiKey.trim(),
        "anthropic-version": "2023-06-01",
        // Required for calls made straight from a browser.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: maxTokens,
        system,
        stream: true,
        messages: [{ role: "user", content }],
      }),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ClaudeError("Could not reach the Claude API. Check your connection and the base URL in Settings.");
  }

  if (!res.ok) throw new ClaudeError(await errorMessage(res));
  if (!res.body) throw new ClaudeError("The API returned no data.");

  let text = "";
  let stopReason: string | null = null;
  for await (const { event, data } of parseSse(res.body)) {
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    if (event === "content_block_delta" && json.delta?.type === "text_delta") {
      text += json.delta.text;
      onProgress?.(text.length);
    } else if (event === "message_delta" && json.delta?.stop_reason) {
      stopReason = json.delta.stop_reason;
    } else if (event === "error") {
      throw new ClaudeError(json.error?.message ?? "The API reported an error.");
    }
  }
  return { text, stopReason };
}

/** Sends a tiny request to check that the key and model work. */
export async function testConnection(settings: ClaudeSettings, fetchImpl?: typeof fetch) {
  const r = await streamMessage({
    settings,
    system: "Reply with the single word: ok",
    content: [textBlock("ping")],
    maxTokens: 16,
    fetchImpl,
  });
  return r.text.trim();
}
