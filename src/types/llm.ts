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

/** Static fallback suggestions when the provider's discovery returned nothing. */
export const MODEL_SUGGESTIONS: Record<ProviderType, ModelSuggestion[]> = {
  anthropic: [
    { group: "Claude 4", id: "claude-opus-4-7", label: "Claude Opus 4.7" },
    { group: "Claude 4", id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { group: "Claude 4", id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    { group: "Claude 3.x", id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
  ],
  openai: [
    { group: "GPT-4o", id: "gpt-4o", label: "GPT-4o" },
    { group: "GPT-4o", id: "gpt-4o-mini", label: "GPT-4o mini" },
    { group: "GPT-4.1", id: "gpt-4.1", label: "GPT-4.1" },
    { group: "Reasoning", id: "o3", label: "o3" },
  ],
  gemini: [
    { group: "Gemini 2.5", id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { group: "Gemini 2.5", id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  ollama: [
    { group: "Local", id: "llama3.2", label: "Llama 3.2" },
    { group: "Local", id: "qwen2.5:7b", label: "Qwen 2.5 7B" },
  ],
  lmstudio: [],
  openrouter: [
    { group: "Anthropic", id: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7" },
    { group: "OpenAI", id: "openai/gpt-4o", label: "GPT-4o" },
  ],
  azure: [],
  "github-copilot": [
    { group: "Anthropic", id: "claude-sonnet-4", label: "Claude Sonnet 4" },
    { group: "OpenAI", id: "gpt-4o", label: "GPT-4o" },
  ],
  "kilo-gateway": [{ group: "Auto", id: "kilo/auto", label: "Kilo (auto)" }],
  bedrock: [
    { group: "Anthropic (EU)", id: "eu.anthropic.claude-opus-4-6-v1", label: "Claude Opus 4.6 (EU)" },
    { group: "Anthropic (US)", id: "us.anthropic.claude-opus-4-6-v1", label: "Claude Opus 4.6 (US)" },
  ],
  "chatgpt-oauth": [
    { group: "GPT-5", id: "gpt-5", label: "GPT-5" },
    { group: "GPT-5", id: "gpt-5-codex", label: "GPT-5 Codex" },
  ],
  custom: [],
};

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
