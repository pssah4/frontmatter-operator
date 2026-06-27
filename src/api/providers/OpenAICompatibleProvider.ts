import { requestUrl, type RequestUrlParam } from "obsidian";
import type {
  CompletionRequest,
  CompletionResult,
  ProviderConfig,
  ProviderType,
  RunModelOptions,
} from "../../types/llm";
import {
  DEFAULT_BASE_URLS,
  DEFAULT_API_VERSIONS,
  ProviderError,
  isTemperatureFixed,
  recommendedMaxTokens,
} from "../../types/llm";
import type { ApiHandler } from "../types";

export interface OpenAICompatibleOptions {
  /** Override the bearer token (used by GitHub Copilot / ChatGPT OAuth flows). */
  overrideToken?: string;
  /** Extra headers (e.g. Copilot Editor-Version, Kilo organization id). */
  extraHeaders?: Record<string, string>;
  /** Override the chat-completions URL (used by Azure deployments). */
  urlOverride?: string;
  /** Provider-baseUrl override (Copilot / Kilo / ChatGPT pin custom hosts). */
  baseUrlOverride?: string;
}

/**
 * Shared POST /chat/completions handler covering openai, openrouter, custom,
 * ollama, lmstudio, azure, github-copilot, kilo-gateway, chatgpt-oauth.
 */
export class OpenAICompatibleProvider implements ApiHandler {
  readonly providerType: string;

  constructor(
    private provider: ProviderConfig,
    private model: RunModelOptions,
    private opts: OpenAICompatibleOptions = {},
  ) {
    this.providerType = provider.type;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const baseUrl = (
      this.opts.baseUrlOverride ??
      this.provider.baseUrl ??
      DEFAULT_BASE_URLS[this.provider.type] ??
      ""
    ).replace(/\/+$/, "");
    if (!baseUrl && !this.opts.urlOverride) {
      throw new ProviderError(
        `${this.providerType} provider has no base URL.`,
        this.provider.type,
      );
    }
    const url = this.opts.urlOverride ?? this.buildUrl(baseUrl);

    const messages = [
      { role: "system", content: req.systemPrompt },
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const body: Record<string, unknown> = {
      model: this.model.modelId,
      messages,
    };
    const maxTokens =
      req.maxTokens ?? this.model.maxTokens ?? recommendedMaxTokens(this.model.modelId);
    if (maxTokens) body.max_tokens = maxTokens;

    if (!isTemperatureFixed(this.provider.type, this.model.modelId)) {
      const temp = req.temperature ?? this.model.temperature ?? 0;
      body.temperature = temp;
    }

    if (this.model.reasoningEffort) {
      body.reasoning = { effort: this.model.reasoningEffort };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.opts.extraHeaders ?? {}),
    };
    const token = this.opts.overrideToken ?? this.provider.apiKey;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    if (this.provider.type === "openrouter") {
      headers["HTTP-Referer"] =
        headers["HTTP-Referer"] ??
        "https://github.com/pssah4/frontmatter-editor-dev";
      headers["X-Title"] = headers["X-Title"] ?? "Frontmatter Editor";
    }

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
        this.provider.type,
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
      model: json.model ?? this.model.modelId,
    };
  }

  private buildUrl(baseUrl: string): string {
    if (this.provider.type === "azure") {
      const apiVersion =
        this.provider.apiVersion ?? DEFAULT_API_VERSIONS.azure ?? "2024-10-21";
      const deployment = this.model.modelId;
      return `${baseUrl}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    }
    return `${baseUrl}/chat/completions`;
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
