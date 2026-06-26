/**
 * LLM provider configuration and shared types. Mirrors the Vault Operator
 * settings schema where reasonable; trimmed to what the property generator
 * actually needs.
 *
 * Phase 1 supports: anthropic, openai, openrouter, custom (OpenAI-compatible
 * incl. Ollama / LM Studio).
 *
 * Phase 2 (follow-up): bedrock, github-copilot, chatgpt-oauth, kilo-gateway.
 */

export type ProviderType =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "custom";

export interface ProviderConfig {
  /** Stable id used as the key in settings.providers[]. */
  id: string;
  type: ProviderType;
  /** User-facing label. */
  displayName: string;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  /** Default model id used when this provider runs a generator. */
  defaultModel?: string;
}

export const PROVIDER_LABELS: Record<ProviderType, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  custom: "Custom (OpenAI-compatible)",
};

export const PROVIDER_DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  custom: "http://localhost:11434/v1",
};

export const MODEL_SUGGESTIONS: Record<ProviderType, string[]> = {
  anthropic: [
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
  ],
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1",
    "gpt-4.1-mini",
  ],
  openrouter: [
    "anthropic/claude-opus-4-7",
    "openai/gpt-4o",
    "meta-llama/llama-3.1-70b-instruct",
  ],
  custom: [
    "llama3.2",
    "qwen2.5:7b",
    "mistral",
  ],
};

/** What the AI service speaks. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  /** Override the provider's default model. */
  model?: string;
  /** Decode-time temperature. Defaults to 0 for deterministic generation. */
  temperature?: number;
  maxTokens?: number;
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
