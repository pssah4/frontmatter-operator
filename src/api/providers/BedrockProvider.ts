import { requestUrl, type RequestUrlParam } from "obsidian";
import type {
  CompletionRequest,
  CompletionResult,
  CustomModel,
} from "../../types/llm";
import { ProviderError, recommendedMaxTokens } from "../../types/llm";
import type { ApiHandler } from "../types";
import { signSigV4 } from "../../auth/AwsSigV4";

/**
 * Amazon Bedrock. Three auth modes:
 *
 * - api-key: Bedrock API Key (bearer-like). Endpoint: bedrock-runtime in
 *   the configured region, header `Authorization: Bearer <key>`. Simplest
 *   mode and ships in Phase 1.
 *
 * - gateway: enterprise gateway in front of Bedrock with a static header.
 *   Same Anthropic Messages payload as native, plus the custom header.
 *
 * - access-key: AWS SigV4 with IAM access key. Full SigV4 implementation in
 *   src/auth/AwsSigV4.ts; we sign the InvokeModel POST against
 *   bedrock-runtime in the configured region.
 *
 * Bedrock always speaks the Anthropic Messages format when the model id
 * is anthropic.claude-*; other model families (Nova, Llama) use the
 * inference-profile + InvokeModel route. Phase 1 only supports the
 * Anthropic family because the property generator only needs one model.
 */
export class BedrockProvider implements ApiHandler {
  readonly providerType = "bedrock";

  constructor(private model: CustomModel) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const region = this.model.awsRegion ?? "eu-central-1";
    const baseUrl = `https://bedrock-runtime.${region}.amazonaws.com`;
    const profile = this.model.name; // e.g. "eu.anthropic.claude-opus-4-6-v1"
    const url = `${baseUrl}/model/${encodeURIComponent(profile)}/invoke`;

    const isAnthropic = /anthropic\.claude/i.test(profile);
    if (!isAnthropic) {
      throw new ProviderError(
        "Bedrock Phase 1 supports Anthropic-family models only. Use a `*.anthropic.claude-*` profile.",
        "bedrock",
      );
    }

    const maxTokens =
      req.maxTokens ?? this.model.maxTokens ?? recommendedMaxTokens(this.model.name);

    const body: Record<string, unknown> = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: maxTokens,
      system: req.systemPrompt,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: req.temperature ?? this.model.temperature ?? 0,
    };
    if (this.model.thinkingEnabled) {
      body.thinking = {
        type: "enabled",
        budget_tokens: this.model.thinkingBudgetTokens ?? 10_000,
      };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    const mode = this.model.awsAuthMode ?? "api-key";
    if (mode === "api-key") {
      if (!this.model.awsApiKey) {
        throw new ProviderError("Bedrock api-key mode: awsApiKey missing.", "bedrock");
      }
      headers["Authorization"] = `Bearer ${this.model.awsApiKey}`;
    } else if (mode === "gateway") {
      if (!this.model.gatewayHeaderName || this.model.gatewayHeaderValue === undefined) {
        throw new ProviderError(
          "Bedrock gateway mode: gatewayHeader missing.",
          "bedrock",
        );
      }
      headers[this.model.gatewayHeaderName] = this.model.gatewayHeaderValue;
    } else {
      // access-key mode -- sign the request with SigV4.
      if (!this.model.awsAccessKey || !this.model.awsSecretKey) {
        throw new ProviderError(
          "Bedrock access-key mode requires awsAccessKey and awsSecretKey.",
          "bedrock",
        );
      }
      const bodyStr = JSON.stringify(body);
      const signed = await signSigV4({
        method: "POST",
        url,
        region,
        service: "bedrock",
        body: bodyStr,
        extraHeaders: { ...headers },
        credentials: {
          accessKeyId: this.model.awsAccessKey,
          secretAccessKey: this.model.awsSecretKey,
          sessionToken: this.model.awsSessionToken,
        },
      });
      const response = await requestUrl({
        url: signed.url,
        method: signed.method,
        headers: signed.headers,
        body: bodyStr,
        throw: false,
      });
      return parseAnthropicResponse(response, this.model.name, this.providerType);
    }

    const request: RequestUrlParam = {
      url,
      method: "POST",
      headers,
      body: JSON.stringify(body),
      throw: false,
    };

    const response = await requestUrl(request);
    return parseAnthropicResponse(response, this.model.name, this.providerType);
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

function parseAnthropicResponse(
  response: { status: number; json: unknown; text: string },
  fallbackModel: string,
  providerType: string,
): CompletionResult {
  if (response.status < 200 || response.status >= 300) {
    throw new ProviderError(
      `${providerType} ${response.status}: ${shortError(response.json ?? response.text)}`,
      "bedrock",
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
    model: json.model ?? fallbackModel,
  };
}

function shortError(payload: unknown): string {
  if (!payload) return "";
  if (typeof payload === "string") return payload.slice(0, 280);
  const obj = payload as { error?: { message?: string }; message?: string };
  return (obj.error?.message ?? obj.message ?? JSON.stringify(payload)).slice(0, 280);
}
