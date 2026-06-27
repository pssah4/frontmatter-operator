/**
 * Provider + model schema. 1:1 mirror of the Vault Operator CustomModel
 * pattern: a single entity that holds (provider type, model id, auth, decode
 * params) so the user manages individual models rather than provider buckets.
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

export interface CustomModel {
  /** API id (e.g. `claude-opus-4-7`). Stable identifier inside the provider. */
  name: string;
  /** UUID used as the row key in settings.models. */
  id: string;
  provider: ProviderType;
  /** Human-readable label shown in dropdowns. Defaults to `name`. */
  displayName?: string;
  /** Per-model credential. Encrypted at rest via SafeStorage when available. */
  apiKey?: string;
  /** Per-model endpoint override (defaults per provider in {@link DEFAULT_BASE_URLS}). */
  baseUrl?: string;
  /** Azure / enterprise gateway api version (`2024-10-21` etc.). */
  apiVersion?: string;
  /** Excluded from generator dropdowns when false. */
  enabled: boolean;
  /** Cannot edit name/provider when true (shipped defaults). */
  isBuiltIn?: boolean;
  /** Output cap. Undefined = use {@link recommendedMaxTokens}. */
  maxTokens?: number;
  /** Decode temperature. Undefined = provider default. */
  temperature?: number;
  /** Anthropic prompt caching (extends to OpenRouter when supported). */
  promptCachingEnabled?: boolean;
  /** Anthropic extended-thinking switch. */
  thinkingEnabled?: boolean;
  /** Token budget for extended thinking; default 10_000. */
  thinkingBudgetTokens?: number;
  /** Reasoning effort level for o-series / Gemini 2.5 / Claude. */
  reasoningEffort?: "low" | "medium" | "high" | "max";

  // AWS Bedrock
  awsRegion?: string;
  awsAuthMode?: AwsAuthMode;
  awsApiKey?: string;
  awsAccessKey?: string;
  awsSecretKey?: string;
  awsSessionToken?: string;

  // Enterprise gateway (Anthropic / Bedrock)
  gatewayHeaderName?: string;
  gatewayHeaderValue?: string;
  useGateway?: boolean;
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
  // azure: no default -- user provides endpoint
  // bedrock: region-based, computed at runtime
  // github-copilot: hard-coded in provider
  // kilo-gateway: hard-coded in provider
  // chatgpt-oauth: hard-coded codex endpoint
};

export const DEFAULT_API_VERSIONS: Partial<Record<ProviderType, string>> = {
  azure: "2024-10-21",
};

export interface ModelSuggestion {
  group: string;
  id: string;
  label: string;
}

/** Suggestions shown as a grouped quick-pick in the ModelConfigModal. */
export const MODEL_SUGGESTIONS: Record<ProviderType, ModelSuggestion[]> = {
  anthropic: [
    { group: "Claude 4", id: "claude-opus-4-7", label: "Claude Opus 4.7" },
    { group: "Claude 4", id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { group: "Claude 4", id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { group: "Claude 4", id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { group: "Claude 4", id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    { group: "Claude 3.x", id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
    { group: "Claude 3.x", id: "claude-3-5-haiku", label: "Claude 3.5 Haiku" },
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
  ],
  gemini: [
    { group: "Gemini 2.5", id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { group: "Gemini 2.5", id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { group: "Gemini 2.5", id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    { group: "Gemini 2.0", id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],
  ollama: [
    { group: "Local", id: "llama3.2", label: "Llama 3.2" },
    { group: "Local", id: "llama3.1", label: "Llama 3.1" },
    { group: "Local", id: "qwen2.5:7b", label: "Qwen 2.5 7B" },
    { group: "Local", id: "mistral", label: "Mistral" },
  ],
  lmstudio: [],
  openrouter: [
    { group: "Anthropic", id: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7" },
    { group: "Anthropic", id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { group: "OpenAI", id: "openai/gpt-4o", label: "GPT-4o" },
    { group: "OpenAI", id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
    { group: "Mistral", id: "mistralai/mistral-large", label: "Mistral Large" },
    { group: "DeepSeek", id: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
    { group: "Meta", id: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B" },
  ],
  azure: [],
  "github-copilot": [
    { group: "Anthropic", id: "claude-sonnet-4", label: "Claude Sonnet 4" },
    { group: "Anthropic", id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
    { group: "OpenAI", id: "gpt-4o", label: "GPT-4o" },
    { group: "OpenAI", id: "gpt-4o-mini", label: "GPT-4o mini" },
    { group: "Reasoning", id: "o1", label: "o1" },
  ],
  "kilo-gateway": [{ group: "Auto", id: "kilo/auto", label: "Kilo (auto)" }],
  bedrock: [
    { group: "Anthropic (EU)", id: "eu.anthropic.claude-opus-4-6-v1", label: "Claude Opus 4.6 (EU)" },
    { group: "Anthropic (EU)", id: "eu.anthropic.claude-sonnet-4-5-v1", label: "Claude Sonnet 4.5 (EU)" },
    { group: "Anthropic (US)", id: "us.anthropic.claude-opus-4-6-v1", label: "Claude Opus 4.6 (US)" },
    { group: "Amazon", id: "us.amazon.nova-pro-v1:0", label: "Nova Pro" },
  ],
  "chatgpt-oauth": [
    { group: "GPT-5", id: "gpt-5", label: "GPT-5" },
    { group: "GPT-5", id: "gpt-5-mini", label: "GPT-5 mini" },
    { group: "Codex", id: "gpt-5-codex", label: "GPT-5 Codex" },
  ],
  custom: [{ group: "Custom", id: "model", label: "model" }],
};

/** What ships pre-populated under settings.models when the user first opens
 *  the plugin. Empty by default; the user adds via "+ Add model". */
export const BUILT_IN_MODELS: CustomModel[] = [];

/** Pure helpers used throughout the UI. */
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

export function getModelKey(model: CustomModel): string {
  return model.id;
}

export function newModelId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

export function supportsThinking(model: CustomModel): boolean {
  if (model.provider === "anthropic") return true;
  if (model.provider === "bedrock" && model.name.includes("anthropic.claude")) {
    return true;
  }
  if (model.provider === "openrouter" && model.name.includes("anthropic/")) {
    return true;
  }
  if (
    model.provider === "github-copilot" &&
    model.name.toLowerCase().includes("claude")
  ) {
    return true;
  }
  return false;
}

export function supportsPromptCache(model: CustomModel): boolean {
  if (model.provider === "anthropic") return true;
  if (model.provider === "bedrock" && model.name.includes("anthropic.claude")) {
    return true;
  }
  if (model.provider === "openrouter" && model.name.includes("anthropic/")) {
    return true;
  }
  return false;
}

export function isTemperatureFixed(model: CustomModel): boolean {
  const id = model.name.toLowerCase();
  // GPT-5 and o-series reject any non-1.0 temperature.
  if (model.provider === "openai" && (id.startsWith("o") || id.startsWith("gpt-5"))) {
    return true;
  }
  if (model.provider === "chatgpt-oauth" && id.startsWith("gpt-5")) return true;
  return false;
}

export function getMaxTemperature(provider: ProviderType): number {
  if (provider === "anthropic") return 1;
  if (provider === "bedrock") return 1;
  return 2;
}

// ----------------------------------------------------------- chat shape

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  /** Overrides model.maxTokens. */
  maxTokens?: number;
  /** Overrides model.temperature. */
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
