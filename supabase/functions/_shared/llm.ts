/**
 * Unified LLM Client — Supports OpenAI + NVIDIA NIM
 * 
 * NVIDIA NIM provides OpenAI-compatible API endpoints.
 * Configure via environment variables:
 *   LLM_PROVIDER = "openai" | "nvidia" (default: "openai")
 *   NVIDIA_NIM_API_KEY = your NIM API key (or NGC API key)
 *   NVIDIA_NIM_BASE_URL = https://integrate.api.nvidia.com/v1 (default)
 *   NVIDIA_NIM_EMBEDDING_MODEL = nvidia/nv-embedqa-e5-v5 (or other)
 *   NVIDIA_NIM_CHAT_MODEL = meta/llama-3.1-70b-instruct (or other)
 * 
 * For self-hosted NIM: set NVIDIA_NIM_BASE_URL to your NIM endpoint
 */

export type LLMProvider = "openai" | "nvidia"

export interface LLMConfig {
  provider: LLMProvider
  apiKey: string
  baseUrl: string
  embeddingModel: string
  chatModel: string
  embeddingDimensions?: number
}

// The variable names each provider actually reads, in preference order. Anything
// that decides whether retrieval exists — this client, /api/config, /api/health —
// has to consult the same names. api/health.js instead tested NVIDIA_API_KEY, a
// variable no code ever reads, and reported configured:false about a provider it
// had never looked for while /api/config published knowledgeRagEnabled:true.
const KEY_ENVS: Record<LLMProvider, string[]> = {
  openai: ["OPENAI_API_KEY"],
  nvidia: ["NVIDIA_NIM_API_KEY", "NGC_API_KEY"],
}

function firstEnv(names: string[]): string {
  for (const name of names) {
    const value = (Deno.env.get(name) || "").trim()
    if (value) return value
  }
  return ""
}

function currentProvider(): LLMProvider {
  // The site publishes its own llmProvider and /api/health reports the provider it
  // checked, so this must read the same variable or the two name different providers.
  return (Deno.env.get("LLM_PROVIDER") || "").trim() === "nvidia" ? "nvidia" : "openai"
}

// Reported by the callers that would otherwise crash on a missing key, so an
// unconfigured project can answer "not configured" instead of an HTTP 500.
export function llmReadiness() {
  const provider = currentProvider()
  return {
    provider,
    configured: Boolean(firstEnv(KEY_ENVS[provider])),
    keyEnv: KEY_ENVS[provider].join(" or "),
  }
}

function getLLMConfig(): LLMConfig {
  const provider = currentProvider()

  if (provider === "nvidia") {
    return {
      provider: "nvidia",
      apiKey: firstEnv(KEY_ENVS.nvidia),
      baseUrl: Deno.env.get("NVIDIA_NIM_BASE_URL") || "https://integrate.api.nvidia.com/v1",
      embeddingModel: Deno.env.get("NVIDIA_NIM_EMBEDDING_MODEL") || "nvidia/nv-embedqa-e5-v5",
      chatModel: Deno.env.get("NVIDIA_NIM_CHAT_MODEL") || "meta/llama-3.1-70b-instruct",
      embeddingDimensions: parseInt(Deno.env.get("NVIDIA_NIM_EMBEDDING_DIMS") || "1024"),
    }
  }

  return {
    provider: "openai",
    apiKey: firstEnv(KEY_ENVS.openai),
    baseUrl: "https://api.openai.com/v1",
    embeddingModel: Deno.env.get("OPENAI_EMBEDDING_MODEL") || "text-embedding-3-large",
    chatModel: Deno.env.get("OPENAI_CHAT_MODEL") || "gpt-4o-mini",
    embeddingDimensions: 3072,
  }
}

export async function getEmbedding(text: string, config = getLLMConfig()): Promise<number[]> {
  if (!config.apiKey) {
    throw new Error(`no key for provider "${config.provider}" — set ${KEY_ENVS[config.provider].join(" or ")}`)
  }

  const body: Record<string, any> = {
    model: config.embeddingModel,
    input: text,
  }

  if (config.provider === "openai" && config.embeddingDimensions) {
    body.dimensions = config.embeddingDimensions
  }

  const resp = await fetch(`${config.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`${config.provider} embedding error: ${err}`)
  }

  const data = await resp.json()
  const embedding = data.data[0].embedding

  if (config.provider === "openai" && config.embeddingDimensions && config.embeddingDimensions > 1024) {
    return embedding.slice(0, 1024)
  }
  return embedding
}

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface ChatCompletionOptions {
  messages: ChatMessage[]
  temperature?: number
  responseFormat?: { type: "json_object" } | { type: "text" }
  maxTokens?: number
}

export async function chatCompletion(
  options: ChatCompletionOptions,
  config = getLLMConfig()
): Promise<string> {
  if (!config.apiKey) {
    throw new Error(`no key for provider "${config.provider}" — set ${KEY_ENVS[config.provider].join(" or ")}`)
  }

  const body: Record<string, any> = {
    model: config.chatModel,
    messages: options.messages,
    temperature: options.temperature ?? 0.1,
  }

  if (options.responseFormat) {
    body.response_format = options.responseFormat
  }
  if (options.maxTokens) {
    body.max_tokens = options.maxTokens
  }

  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`${config.provider} chat error: ${err}`)
  }

  const data = await resp.json()
  return data.choices[0]?.message?.content || ""
}

export function getClientLLMConfig() {
  const provider = currentProvider()
  return {
    provider,
    chatModel: provider === "nvidia" 
      ? Deno.env.get("NVIDIA_NIM_CHAT_MODEL") || "meta/llama-3.1-70b-instruct"
      : Deno.env.get("OPENAI_CHAT_MODEL") || "gpt-4o-mini",
    embeddingModel: provider === "nvidia"
      ? Deno.env.get("NVIDIA_NIM_EMBEDDING_MODEL") || "nvidia/nv-embedqa-e5-v5"
      : Deno.env.get("OPENAI_EMBEDDING_MODEL") || "text-embedding-3-large",
  }
}