import { requestUrl, type RequestUrlParam } from "obsidian";
import type {
  CompletionRequest,
  CompletionResult,
  ProviderConfig,
} from "../../types/llm";
import { ProviderError } from "../../types/llm";
import { PROVIDER_DEFAULT_BASE_URLS } from "../../types/llm";
import type { ApiHandler } from "../types";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-haiku-4-5";

export class AnthropicProvider implements ApiHandler {
  readonly providerType = "anthropic";

  constructor(private config: ProviderConfig) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (!this.config.apiKey) {
      throw new ProviderError(
        "Anthropic provider has no API key configured.",
        "anthropic",
      );
    }
    const model = req.model ?? this.config.defaultModel ?? DEFAULT_MODEL;
    const baseUrl =
      this.config.baseUrl?.replace(/\/+$/, "") ??
      PROVIDER_DEFAULT_BASE_URLS.anthropic;
    const url = `${baseUrl}/v1/messages`;

    const body = {
      model,
      max_tokens: req.maxTokens ?? 1024,
      system: req.systemPrompt,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: req.temperature ?? 0,
    };

    const request: RequestUrlParam = {
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      throw: false,
    };

    const response = await requestUrl(request);
    if (response.status < 200 || response.status >= 300) {
      throw new ProviderError(
        `Anthropic ${response.status}: ${shortError(response.json ?? response.text)}`,
        "anthropic",
        response.status,
      );
    }

    const json = response.json as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };

    const text = (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    return {
      text,
      usage: {
        inputTokens: json.usage?.input_tokens,
        outputTokens: json.usage?.output_tokens,
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
