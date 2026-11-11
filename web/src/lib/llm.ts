// One entry point for every AI service. Claude uses its own API; the rest speak the OpenAI chat format.
import { ClaudeError, ClaudeSettings, ContentBlock, parseSse, streamMessage, StreamOptions, StreamResult, textBlock } from "./claude";
import { providerInfo } from "./providers";

async function errorText(res: Response): Promise<string> {
  try {
    const b = await res.json();
    const msg = b?.error?.message ?? b?.message ?? (Array.isArray(b) ? b[0]?.error?.message : undefined);
    if (msg) return `${msg} (${res.status})`;
  } catch {
    /* ignore */
  }
  if (res.status === 401 || res.status === 403) return `The API key was rejected (${res.status}).`;
  if (res.status === 429) return "Rate limited by the service (429). Wait a moment and try again.";
  if (res.status === 404) return "Not found (404). Check the model id and the base URL.";
  return `Request failed with status ${res.status}.`;
}

function toOpenAiContent(content: ContentBlock[]) {
  return content.map((b) =>
    b.type === "text"
      ? { type: "text", text: b.text }
      : { type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } },
  );
}

const trimUrl = (u: string) => u.trim().replace(/\/+$/, "");

export async function streamOpenAi(opts: StreamOptions): Promise<StreamResult> {
  const { settings, system, content, maxTokens, signal, onProgress } = opts;
  const info = providerInfo(settings.provider ?? "custom");
  const doFetch = opts.fetchImpl ?? fetch;
  if (info.needsKey && !settings.apiKey.trim()) throw new ClaudeError(`Add your ${info.label} API key in Settings first.`);
  if (!settings.model.trim()) throw new ClaudeError("Choose a model in Settings first.");
  if (!settings.baseUrl.trim()) throw new ClaudeError("Add the base URL in Settings first.");

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (settings.apiKey.trim()) headers.authorization = `Bearer ${settings.apiKey.trim()}`;

  let res: Response;
  try {
    res = await doFetch(`${trimUrl(settings.baseUrl)}/chat/completions`, {
      method: "POST",
      signal,
      headers,
      body: JSON.stringify({
        model: settings.model.trim(),
        [info.tokenParam]: maxTokens,
        stream: true,
        messages: [
          { role: "system", content: system },
          { role: "user", content: toOpenAiContent(content) },
        ],
      }),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ClaudeError(`Could not reach ${info.label}. Check your connection and the base URL in Settings${info.id === "custom" ? " (a local server must allow this page's origin)" : ""}.`);
  }
  if (!res.ok) throw new ClaudeError(await errorText(res));
  if (!res.body) throw new ClaudeError("The service returned no data.");

  let text = "";
  let stopReason: string | null = null;
  for await (const { data } of parseSse(res.body)) {
    if (data === "[DONE]") break;
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    if (json.error) throw new ClaudeError(json.error.message ?? "The service reported an error.");
    const choice = json.choices?.[0];
    const piece = choice?.delta?.content;
    if (typeof piece === "string" && piece) {
      text += piece;
      onProgress?.(text.length);
    }
    if (choice?.finish_reason) stopReason = choice.finish_reason === "length" ? "max_tokens" : choice.finish_reason;
  }
  return { text, stopReason };
}

export function streamChat(opts: StreamOptions): Promise<StreamResult> {
  const p = opts.settings.provider;
  return !p || p === "anthropic" ? streamMessage(opts) : streamOpenAi(opts);
}

export async function testLLM(settings: ClaudeSettings, fetchImpl?: typeof fetch) {
  const r = await streamChat({ settings, system: "Reply with the single word: ok", content: [textBlock("ping")], maxTokens: 64, fetchImpl });
  return r.text.trim();
}

/** Asks the service which models it offers. Returns ids, best effort. */
export async function listModels(settings: ClaudeSettings, fetchImpl?: typeof fetch): Promise<string[]> {
  const doFetch = fetchImpl ?? fetch;
  const info = providerInfo(settings.provider ?? "anthropic");
  const headers: Record<string, string> = {};
  if (info.format === "anthropic") {
    headers["x-api-key"] = settings.apiKey.trim();
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else if (settings.apiKey.trim()) headers.authorization = `Bearer ${settings.apiKey.trim()}`;
  const base = trimUrl(settings.baseUrl || info.baseUrl);
  const url = info.format === "anthropic" ? `${base}/v1/models?limit=100` : `${base}/models`;
  let res: Response;
  try {
    res = await doFetch(url, { headers });
  } catch {
    throw new ClaudeError("Could not reach the service to list models.");
  }
  if (!res.ok) throw new ClaudeError(await errorText(res));
  const body = await res.json();
  const list: any[] = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  return list
    .map((m) => String(m?.id ?? m?.name ?? "").replace(/^models\//, ""))
    .filter(Boolean)
    .filter((id) => !/embed|whisper|tts|moderation|guard|image|dall-e|audio|realtime|transcribe/i.test(id))
    .sort();
}
