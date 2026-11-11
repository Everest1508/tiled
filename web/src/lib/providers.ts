// Which AI services the studio can talk to, and their defaults.
export type ProviderId = "anthropic" | "openai" | "groq" | "gemini" | "openrouter" | "custom" | "bridge";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** "anthropic" = Messages API; "openai" = Chat Completions (also spoken by Groq, Gemini, OpenRouter, Ollama…). */
  format: "anthropic" | "openai" | "bridge";
  baseUrl: string;
  model: string;
  /** Suggestions only. Model names change often, so any id can be typed and "Load models" asks the service. */
  models: string[];
  keyUrl?: string;
  keyHint: string;
  needsKey: boolean;
  /** OpenAI's newer models reject max_tokens; everyone else still expects it. */
  tokenParam: "max_tokens" | "max_completion_tokens";
  note: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic", label: "Claude", format: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
    keyUrl: "https://console.anthropic.com/settings/keys", keyHint: "sk-ant-…", needsKey: true, tokenParam: "max_tokens",
    note: "Best results for maps and tile naming.",
  },
  {
    id: "openai", label: "OpenAI", format: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-5.6-terra",
    models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-4.1"],
    keyUrl: "https://platform.openai.com/api-keys", keyHint: "sk-…", needsKey: true, tokenParam: "max_completion_tokens",
    note: "Pick a model that accepts images to name tiles.",
  },
  {
    id: "groq", label: "Groq", format: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "meta-llama/llama-4-scout-17b-16e-instruct",
    models: ["meta-llama/llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct", "llama-3.3-70b-versatile"],
    keyUrl: "https://console.groq.com/keys", keyHint: "gsk_…", needsKey: true, tokenParam: "max_tokens",
    note: "Very fast. Naming tiles needs a vision model (Llama 4). Text-only models can still generate maps.",
  },
  {
    id: "gemini", label: "Gemini", format: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.8-flash",
    models: ["gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-2.5-flash"],
    keyUrl: "https://aistudio.google.com/apikey", keyHint: "AIza…", needsKey: true, tokenParam: "max_tokens",
    note: "Has a free tier. Handles images.",
  },
  {
    id: "openrouter", label: "OpenRouter", format: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "",
    models: [],
    keyUrl: "https://openrouter.ai/keys", keyHint: "sk-or-…", needsKey: true, tokenParam: "max_tokens",
    note: "One key for hundreds of models. Choose a model id like provider/name, or use Load models.",
  },
  {
    id: "custom", label: "Custom / local", format: "openai", baseUrl: "http://localhost:11434/v1", model: "",
    models: [],
    keyHint: "Optional", needsKey: false, tokenParam: "max_tokens",
    note: "Any OpenAI-compatible server: Ollama, LM Studio, vLLM, a proxy. A local server must allow this page's address (for Ollama set OLLAMA_ORIGINS).",
  },
  {
    id: "bridge", label: "Claude Code", format: "bridge", baseUrl: "", model: "", models: [],
    keyHint: "", needsKey: false, tokenParam: "max_tokens", note: "Uses your Claude Code subscription through a local bridge.",
  },
];

export const providerInfo = (id: string): ProviderInfo => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];

/** Older saved settings used "api" for Claude. */
export const normalizeProvider = (id: unknown): ProviderId => (id === "api" ? "anthropic" : PROVIDERS.some((p) => p.id === id) ? (id as ProviderId) : "anthropic");
