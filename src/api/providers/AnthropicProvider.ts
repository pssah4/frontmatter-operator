import { requestUrl, type RequestUrlParam } from "obsidian";
import type {
  CompletionRequest,
  CompletionResult,
  ProviderConfig,
  RunModelOptions,
} from "../../types/llm";
import {
  DEFAULT_BASE_URLS,
  ProviderError,
  recommendedMaxTokens,
  modelSupportsTemperature,
} from "../../types/llm";
import type { ApiHandler } from "../types";
import { assertValidHeader } from "../headerValidation";
import { assertSafeProviderUrl } from "../providerUrlGuard";

const ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicProvider implements ApiHandler {
  readonly providerType = "anthropic";

  constructor(
    private provider: ProviderConfig,
    private model: RunModelOptions,
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (!this.provider.apiKey && !this.provider.useGateway) {
      throw new ProviderError(
        "Anthropic provider has no API key configured.",
        "anthropic",
      );
    }
    const baseUrl = (
      this.provider.baseUrl ?? DEFAULT_BASE_URLS.anthropic!
    ).replace(/\/+$/, "");
    const url = `${baseUrl}/v1/messages`;
    // M-1 SSRF (AUDIT 2026-07-01): the base URL is user-editable (self-hosted
    // gateway override), so guard it before the x-api-key leaves the machine --
    // same control the Gemini / OpenAI-compatible generate paths already apply.
    assertSafeProviderUrl(url, "anthropic");

    const maxTokens =
      req.maxTokens ?? this.model.maxTokens ?? recommendedMaxTokens(this.model.modelId);

    const body: Record<string, unknown> = {
      model: this.model.modelId,
      max_tokens: maxTokens,
      system: req.systemPrompt,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    // Claude 5 generation, Opus 4.7+ and Fable/Mythos dropped the sampling
    // parameters and 400 on any value ("temperature ... deprecated"); omit it.
    if (modelSupportsTemperature(this.model.modelId)) {
      if (req.temperature !== undefined) {
        body.temperature = req.temperature;
      } else if (this.model.temperature !== undefined) {
        body.temperature = this.model.temperature;
      } else {
        body.temperature = 0;
      }
    }
    if (this.model.thinkingEnabled) {
      body.thinking = {
        type: "enabled",
        budget_tokens: this.model.thinkingBudgetTokens ?? 10_000,
      };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
    };
    if (this.provider.useGateway && this.provider.gatewayHeaderName) {
      // L-4 SAST (AUDIT 2026-06-29): validate header name + value
      // before injection. Throws a clean error if the user typed
      // an invalid RFC 7230 token or tried to overwrite a reserved
      // header (Host, Authorization, etc.).
      const headerValue = this.provider.gatewayHeaderValue ?? "";
      assertValidHeader(this.provider.gatewayHeaderName, headerValue);
      headers[this.provider.gatewayHeaderName] = headerValue;
    }
    if (this.provider.apiKey) headers["x-api-key"] = this.provider.apiKey;

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
      model: json.model ?? this.model.modelId,
    };
  }

  async ping(): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
    try {
      const r = await this.complete({
        systemPrompt: "Reply with the single word 'pong'.",
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
