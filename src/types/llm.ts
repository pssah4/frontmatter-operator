/**
 * Provider + per-run model options. Matches the Vault Operator pattern where
 * the user manages provider _accounts_ (identity + auth) and selects the
 * concrete model at run time inside the AI chat / generator modal.
 */

export type ProviderType =
  | "anthropic"
  | "openai"
  | "gemini"
  | "ollama"
  | "lmstudio"
  | "openrouter"
  | "azure"
  | "custom"
  | "github-copilot"
  | "kilo-gateway"
  | "bedrock"
  | "chatgpt-oauth";

export type AwsAuthMode = "api-key" | "access-key" | "gateway";

/**
 * One provider account: identity + authentication + last-known discovery
 * result. Decode parameters (max tokens, temperature, thinking budget) live
 * on RunModelOptions, picked per generation run.
 */
export interface ProviderConfig {
  id: string;
  type: ProviderType;
  displayName: string;
  enabled: boolean;

  // ----- Authentication -----
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;

  // Bedrock
  awsRegion?: string;
  awsAuthMode?: AwsAuthMode;
  awsApiKey?: string;
  awsAccessKey?: string;
  awsSecretKey?: string;
  awsSessionToken?: string;

  // Enterprise gateway (Anthropic, Bedrock)
  gatewayHeaderName?: string;
  gatewayHeaderValue?: string;
  useGateway?: boolean;

  // ----- Discovery cache -----
  /** Cached model list from last successful Refresh. */
  discoveredModels?: DiscoveredModel[];
  discoveredAt?: number;
}

export interface DiscoveredModel {
  id: string;
  label: string;
  group?: string;
}

/**
 * Run-time selection inside the AI chat / generator modal. Determines which
 * model is called and which decode parameters are applied. None of these
 * live on ProviderConfig.
 */
export interface RunModelOptions {
  modelId: string;
  maxTokens?: number;
  temperature?: number;
  promptCachingEnabled?: boolean;
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number;
  reasoningEffort?: "low" | "medium" | "high" | "max";
}

export const PROVIDER_LABELS: Record<ProviderType, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  openrouter: "OpenRouter",
  azure: "Azure OpenAI",
  "github-copilot": "GitHub Copilot",
  "kilo-gateway": "Kilo Gateway",
  bedrock: "Amazon Bedrock",
  "chatgpt-oauth": "ChatGPT (OAuth)",
  custom: "Custom (OpenAI-compatible)",
};

export const PROVIDER_COLORS: Record<ProviderType, string> = {
  anthropic: "#c27c4a",
  openai: "#10a37f",
  gemini: "#4285f4",
  ollama: "#5c6bc0",
  lmstudio: "#e05c2c",
  openrouter: "#7c3aed",
  azure: "#0078d4",
  "github-copilot": "#6e40c9",
  "kilo-gateway": "#ff6200",
  bedrock: "#ff9900",
  "chatgpt-oauth": "#10a37f",
  custom: "#78909c",
};

export const DEFAULT_BASE_URLS: Partial<Record<ProviderType, string>> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234",
  openrouter: "https://openrouter.ai/api/v1",
};

export const DEFAULT_API_VERSIONS: Partial<Record<ProviderType, string>> = {
  azure: "2024-10-21",
};

export interface ModelSuggestion {
  group: string;
  id: string;
  label: string;
}

/**
 * Static fallback suggestions. Ported 1:1 from Vault Operator
 * (src/ui/settings/constants.ts). For providers that ship a live
 * discovery endpoint these are only used until the user clicks Refresh.
 * ChatGPT-OAuth picks must stay a subset of the Codex /codex/models
 * lineup; otherwise the backend rejects them as "not supported when
 * using Codex with a ChatGPT account".
 */
export const MODEL_SUGGESTIONS: Record<ProviderType, ModelSuggestion[]> = {
  anthropic: [
    { group: "Claude 4", id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { group: "Claude 4", id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { group: "Claude 4", id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    { group: "Claude 3.x", id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
    { group: "Claude 3.x", id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
    { group: "Claude 3.x", id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  ],
  openai: [
    { group: "GPT-5", id: "gpt-5", label: "GPT-5" },
    { group: "GPT-5", id: "gpt-5-mini", label: "GPT-5 mini" },
    { group: "GPT-4.1", id: "gpt-4.1", label: "GPT-4.1" },
    { group: "GPT-4.1", id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    { group: "GPT-4.1", id: "gpt-4.1-nano", label: "GPT-4.1 nano" },
    { group: "GPT-4o", id: "gpt-4o", label: "GPT-4o" },
    { group: "GPT-4o", id: "gpt-4o-mini", label: "GPT-4o mini" },
    { group: "Reasoning", id: "o3", label: "o3" },
    { group: "Reasoning", id: "o4-mini", label: "o4-mini" },
    { group: "Reasoning", id: "o1", label: "o1" },
    { group: "Codex", id: "codex-mini-latest", label: "Codex Mini" },
  ],
  gemini: [
    { group: "Gemini 2.5", id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { group: "Gemini 2.5", id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { group: "Gemini 2.5", id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
    { group: "Gemini 2.0", id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],
  ollama: [],
  lmstudio: [],
  openrouter: [
    { group: "Anthropic", id: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6" },
    { group: "Anthropic", id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { group: "Anthropic", id: "anthropic/claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
    { group: "Anthropic", id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
    { group: "OpenAI", id: "openai/gpt-5", label: "GPT-5" },
    { group: "OpenAI", id: "openai/gpt-4.1", label: "GPT-4.1" },
    { group: "OpenAI", id: "openai/gpt-4o", label: "GPT-4o" },
    { group: "OpenAI", id: "openai/o3", label: "o3" },
    { group: "OpenAI", id: "openai/o4-mini", label: "o4-mini" },
    { group: "Mistral", id: "mistralai/mistral-large-latest", label: "Mistral Large" },
    { group: "Mistral", id: "mistralai/mistral-medium-3", label: "Mistral Medium 3" },
    { group: "DeepSeek", id: "deepseek/deepseek-chat-v3-0324", label: "DeepSeek V3" },
    { group: "DeepSeek", id: "deepseek/deepseek-r1", label: "DeepSeek R1" },
    { group: "Kimi", id: "moonshotai/kimi-k2", label: "Kimi K2" },
  ],
  azure: [],
  "github-copilot": [
    { group: "Anthropic", id: "claude-sonnet-4", label: "Claude Sonnet 4" },
    { group: "Anthropic", id: "claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
    { group: "OpenAI", id: "gpt-5.4", label: "GPT-5.4" },
    { group: "OpenAI", id: "gpt-4o", label: "GPT-4o" },
    { group: "OpenAI", id: "gpt-4o-mini", label: "GPT-4o mini" },
    { group: "OpenAI", id: "gpt-4.1", label: "GPT-4.1" },
    { group: "Reasoning", id: "o3-mini", label: "o3-mini" },
    { group: "Reasoning", id: "o4-mini", label: "o4-mini" },
  ],
  "kilo-gateway": [
    { group: "Kilo", id: "kilo/auto", label: "Auto (recommended)" },
  ],
  // Bedrock: cross-region inference profile IDs. `eu.` routes EU regions
  // (Frankfurt/Ireland/Paris), `us.` routes US regions. Direct model IDs
  // (no prefix) only work in the specific hosting region. All entries
  // below are verified Converse-compatible (text-or-chat models).
  bedrock: [
    { group: "Claude 4 (EU)", id: "eu.anthropic.claude-opus-4-6-v1", label: "Claude Opus 4.6 (EU)" },
    { group: "Claude 4 (EU)", id: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0", label: "Claude Sonnet 4.5 (EU)" },
    { group: "Claude 4 (EU)", id: "eu.anthropic.claude-opus-4-5-20250930-v1:0", label: "Claude Opus 4.5 (EU)" },
    { group: "Claude 4 (EU)", id: "eu.anthropic.claude-haiku-4-5-20251001-v1:0", label: "Claude Haiku 4.5 (EU)" },
    { group: "Claude 3.x (EU)", id: "eu.anthropic.claude-3-7-sonnet-20250219-v1:0", label: "Claude 3.7 Sonnet (EU)" },
    { group: "Claude 3.x (EU)", id: "eu.anthropic.claude-3-5-sonnet-20241022-v2:0", label: "Claude 3.5 Sonnet v2 (EU)" },
    { group: "Claude 4 (US)", id: "us.anthropic.claude-opus-4-6-v1", label: "Claude Opus 4.6 (US)" },
    { group: "Claude 4 (US)", id: "us.anthropic.claude-sonnet-4-5-20250929-v1:0", label: "Claude Sonnet 4.5 (US)" },
    { group: "Claude 4 (US)", id: "us.anthropic.claude-opus-4-5-20250930-v1:0", label: "Claude Opus 4.5 (US)" },
    { group: "Claude 4 (US)", id: "us.anthropic.claude-haiku-4-5-20251001-v1:0", label: "Claude Haiku 4.5 (US)" },
    { group: "Claude 3.x (US)", id: "us.anthropic.claude-3-7-sonnet-20250219-v1:0", label: "Claude 3.7 Sonnet (US)" },
    { group: "Claude 3.x (US)", id: "us.anthropic.claude-3-5-sonnet-20241022-v2:0", label: "Claude 3.5 Sonnet v2 (US)" },
    { group: "Amazon Nova", id: "eu.amazon.nova-pro-v1:0", label: "Nova Pro (EU)" },
    { group: "Amazon Nova", id: "eu.amazon.nova-lite-v1:0", label: "Nova Lite (EU)" },
    { group: "Amazon Nova", id: "us.amazon.nova-pro-v1:0", label: "Nova Pro (US)" },
    { group: "Amazon Nova", id: "us.amazon.nova-lite-v1:0", label: "Nova Lite (US)" },
  ],
  // ChatGPT OAuth: MUST stay subset of Codex KNOWN_MODELS in
  // ChatGptResponsesProvider. gpt-5 / gpt-5-codex are NOT on the Codex
  // backend lineup; only the gpt-5.x ids are accepted.
  "chatgpt-oauth": [
    { group: "GPT-5", id: "gpt-5.5", label: "GPT-5.5" },
    { group: "GPT-5", id: "gpt-5.4", label: "GPT-5.4" },
    { group: "GPT-5", id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
  ],
  custom: [],
};

/**
 * Default model id when a fresh provider of this type is created. Picks
 * the first suggestion (typically the flagship). Empty string for
 * providers that have no static suggestions (azure / ollama / lmstudio /
 * custom) -- the user must enter a model id manually for those.
 */
export function getDefaultModelForProvider(p: ProviderType): string {
  return MODEL_SUGGESTIONS[p]?.[0]?.id ?? "";
}

// --------------------------------------------------------- helpers

export function getProviderLabel(p: ProviderType): string {
  return PROVIDER_LABELS[p];
}

export function getDefaultBaseUrlForProvider(p: ProviderType): string | undefined {
  return DEFAULT_BASE_URLS[p];
}

export function getDefaultApiVersionForProvider(
  p: ProviderType,
): string | undefined {
  return DEFAULT_API_VERSIONS[p];
}

export function newProviderId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Output-token ceilings used to clamp the max-tokens slider. */
export function getModelOutputCeiling(modelId: string): number | undefined {
  const id = modelId.toLowerCase();
  if (id.includes("claude-opus")) return 32_000;
  if (id.includes("claude-sonnet")) return 64_000;
  if (id.includes("claude-haiku")) return 64_000;
  if (id.includes("gpt-5")) return 128_000;
  if (id.includes("gpt-4.1")) return 32_768;
  if (id.includes("gpt-4o")) return 16_384;
  if (id.includes("o3") || id.includes("o4") || id.includes("o1")) return 100_000;
  if (id.includes("gemini-2.5")) return 65_536;
  return undefined;
}

export function recommendedMaxTokens(modelId: string): number {
  const ceil = getModelOutputCeiling(modelId);
  if (ceil) return Math.min(ceil, 32_000);
  return 8_192;
}

export function supportsThinking(
  provider: ProviderType,
  modelId: string,
): boolean {
  const id = modelId.toLowerCase();
  if (provider === "anthropic") return true;
  if (provider === "bedrock" && id.includes("anthropic.claude")) return true;
  if (provider === "openrouter" && id.startsWith("anthropic/")) return true;
  if (provider === "github-copilot" && id.includes("claude")) return true;
  return false;
}

export function supportsPromptCache(
  provider: ProviderType,
  modelId: string,
): boolean {
  const id = modelId.toLowerCase();
  if (provider === "anthropic") return true;
  if (provider === "bedrock" && id.includes("anthropic.claude")) return true;
  if (provider === "openrouter" && id.startsWith("anthropic/")) return true;
  return false;
}

export function isTemperatureFixed(
  provider: ProviderType,
  modelId: string,
): boolean {
  const id = modelId.toLowerCase();
  if (provider === "openai" && (id.startsWith("o") || id.startsWith("gpt-5"))) {
    return true;
  }
  if (provider === "chatgpt-oauth" && id.startsWith("gpt-5")) return true;
  return false;
}

export function getMaxTemperature(provider: ProviderType): number {
  if (provider === "anthropic") return 1;
  if (provider === "bedrock") return 1;
  return 2;
}

/**
 * Whether a model still accepts the `temperature` sampling parameter.
 * Some recent models removed sampling parameters (temperature, top_p, top_k)
 * from their request surface and reject any value with a 400 -- on Bedrock the
 * Converse API surfaces this as `ValidationException: `temperature` is
 * deprecated for this model`. The parameter has to be omitted entirely.
 *
 * Ported from Vault Operator's model-registry (FIX-04-03-02) and extended for
 * the Claude 5 generation:
 *  - Claude 5 (sonnet-5 / opus-5 / haiku-5): sampling parameters removed.
 *  - Claude Opus 4.7+ snapshots (4-7, 4-8, ... a future 4-10/4-11): removed.
 *    Opus 4.6 and earlier single-digit minors still accept temperature.
 *  - Claude Fable / Mythos families: removed.
 *  - OpenAI GPT-5.x: default-only temperature, safer to omit.
 *
 * Matched un-anchored so every id form maps to the same answer: direct
 * (claude-sonnet-5), Bedrock cross-region (eu./us./global.anthropic.claude-
 * sonnet-5-...-v1:0) and OpenRouter (anthropic/claude-sonnet-5).
 */
export function modelSupportsTemperature(modelId: string): boolean {
  const id = modelId.toLowerCase();
  // Claude 5 generation.
  if (/claude-(?:opus|sonnet|haiku)-5\b/.test(id)) return false;
  // Claude Opus 4.7+ snapshots (never 4-6 or earlier single-digit minors).
  if (/claude-opus-4-(?:[7-9]|\d\d+)\b/.test(id)) return false;
  // Claude Fable / Mythos families.
  if (/claude-(?:fable|mythos)\b/.test(id)) return false;
  // OpenAI GPT-5 family.
  if (/\bgpt-5(?:\b|[.-])/.test(id)) return false;
  return true;
}

// ----------------------------------------------------------- chat shape

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  /** Override the model's maxTokens. */
  maxTokens?: number;
  /** Override the model's temperature. */
  temperature?: number;
  abortSignal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  model: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: ProviderType,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
