import { requestUrl, type RequestUrlParam } from "obsidian";
import type {
  CompletionRequest,
  CompletionResult,
  ProviderConfig,
  ProviderType,
} from "../../types/llm";
import { ProviderError } from "../../types/llm";
import { PROVIDER_DEFAULT_BASE_URLS } from "../../types/llm";
import type { ApiHandler } from "../types";

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  openrouter: "openai/gpt-4o-mini",
  custom: "llama3.2",
};

/**
 * Shared OpenAI-compatible POST /chat/completions handler. Used for OpenAI,
 * OpenRouter, and any custom endpoint that speaks the OpenAI chat completions
 * shape (Ollama, LM Studio, vLLM, llama.cpp server, etc.).
 */
export class OpenAICompatibleProvider implements ApiHandler {
  readonly providerType: string;

  constructor(private config: ProviderConfig) {
    this.providerType = config.type;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const type = this.config.type as ProviderType;
    if (type === "openai" && !this.config.apiKey) {
      throw new ProviderError("OpenAI provider has no API key.", type);
    }
    if (type === "openrouter" && !this.config.apiKey) {
      throw new ProviderError("OpenRouter provider has no API key.", type);
    }

    const model =
      req.model ??
      this.config.defaultModel ??
      DEFAULT_MODELS[type] ??
      "gpt-4o-mini";
    const baseUrl = (
      this.config.baseUrl ?? PROVIDER_DEFAULT_BASE_URLS[type]
    ).replace(/\/+$/, "");
    const url = `${baseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }
    if (type === "openrouter") {
      headers["HTTP-Referer"] = "https://github.com/pssah4/frontmatter-editor-dev";
      headers["X-Title"] = "Frontmatter Editor";
    }

    const messages = [
      { role: "system", content: req.systemPrompt },
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const body = {
      model,
      messages,
      temperature: req.temperature ?? 0,
      max_tokens: req.maxTokens,
    };

    const request: RequestUrlParam = {
      url,
      method: "POST",
      headers,
      body: JSON.stringify(body),
      throw: false,
    };

    const response = await requestUrl(request);
    if (response.status < 200 || response.status >= 300) {
      throw new ProviderError(
        `${this.providerType} ${response.status}: ${shortError(response.json ?? response.text)}`,
        type,
        response.status,
      );
    }

    const json = response.json as {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };

    const text = json.choices?.[0]?.message?.content ?? "";
    return {
      text,
      usage: {
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
      },
      model: json.model ?? model,
    };
  }

  async ping(): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
    try {
      const r = await this.complete({
        systemPrompt: "You reply with the single word 'pong'.",
        messages: [{ role: "user", content: "ping" }],
        maxTokens: 16,
      });
      return { ok: true, model: r.model };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function shortError(payload: unknown): string {
  if (!payload) return "";
  if (typeof payload === "string") return payload.slice(0, 280);
  const obj = payload as { error?: { message?: string }; message?: string };
  return (obj.error?.message ?? obj.message ?? JSON.stringify(payload)).slice(
    0,
    280,
  );
}
