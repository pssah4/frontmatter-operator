import { requestUrl, type RequestUrlParam } from "obsidian";
import type {
  CompletionRequest,
  CompletionResult,
  ProviderConfig,
  RunModelOptions,
} from "../../types/llm";
import { ProviderError, recommendedMaxTokens } from "../../types/llm";
import type { ApiHandler } from "../types";

const DEFAULT_HOST = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiProvider implements ApiHandler {
  readonly providerType = "gemini";

  constructor(
    private provider: ProviderConfig,
    private model: RunModelOptions,
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (!this.provider.apiKey) {
      throw new ProviderError("Gemini needs an API key.", "gemini");
    }
    const host = (
      this.provider.baseUrl?.replace(/\/openai\/?$/, "") ?? DEFAULT_HOST
    ).replace(/\/+$/, "");
    // M-2 (AUDIT 2026-06-29): API key in the x-goog-api-key header
    // instead of the query string. Google's v1beta accepts both;
    // the query-string form leaks via proxy/server access logs.
    const url = `${host}/models/${this.model.modelId}:generateContent`;

    const contents = req.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      systemInstruction: { role: "system", parts: [{ text: req.systemPrompt }] },
      contents,
      generationConfig: {
        temperature: req.temperature ?? this.model.temperature ?? 0,
        maxOutputTokens:
          req.maxTokens ?? this.model.maxTokens ?? recommendedMaxTokens(this.model.modelId),
      },
    };

    const request: RequestUrlParam = {
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.provider.apiKey,
      },
      body: JSON.stringify(body),
      throw: false,
    };

    const response = await requestUrl(request);
    if (response.status < 200 || response.status >= 300) {
      throw new ProviderError(
        `Gemini ${response.status}: ${shortError(response.json ?? response.text)}`,
        "gemini",
        response.status,
      );
    }

    const json = response.json as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      modelVersion?: string;
    };
    const text =
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
      "";
    return {
      text,
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount,
        outputTokens: json.usageMetadata?.candidatesTokenCount,
      },
      model: json.modelVersion ?? this.model.modelId,
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
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

function shortError(payload: unknown): string {
  if (!payload) return "";
  if (typeof payload === "string") return payload.slice(0, 280);
  const obj = payload as { error?: { message?: string }; message?: string };
  return (obj.error?.message ?? obj.message ?? JSON.stringify(payload)).slice(0, 280);
}
