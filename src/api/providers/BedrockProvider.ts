import { requestUrl, type RequestUrlParam } from "obsidian";
import type {
  CompletionRequest,
  CompletionResult,
  ProviderConfig,
  RunModelOptions,
} from "../../types/llm";
import { ProviderError, recommendedMaxTokens } from "../../types/llm";
import type { ApiHandler } from "../types";
import { signSigV4 } from "../../auth/AwsSigV4";
import { scrubAwsError } from "../fetchModels";

export class BedrockProvider implements ApiHandler {
  readonly providerType = "bedrock";

  constructor(
    private provider: ProviderConfig,
    private model: RunModelOptions,
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const region = this.provider.awsRegion ?? "eu-central-1";
    const baseUrl = `https://bedrock-runtime.${region}.amazonaws.com`;
    const profile = this.model.modelId;
    // raw modelId -- the SigV4 canonicalizer is the single source of truth for
    // path encoding. Pre-encoding would double-encode (see audit fix).
    const url = `${baseUrl}/model/${profile}/invoke`;

    const isAnthropic = /anthropic\.claude/i.test(profile);
    if (!isAnthropic) {
      throw new ProviderError(
        "Bedrock currently supports Anthropic-family models only. Use an `anthropic.claude-*` profile.",
        "bedrock",
      );
    }

    const maxTokens =
      req.maxTokens ?? this.model.maxTokens ?? recommendedMaxTokens(this.model.modelId);

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
    const mode = this.provider.awsAuthMode ?? "api-key";
    if (mode === "api-key") {
      if (!this.provider.awsApiKey) {
        throw new ProviderError("Bedrock api-key mode: awsApiKey missing.", "bedrock");
      }
      headers["Authorization"] = `Bearer ${this.provider.awsApiKey}`;
    } else if (mode === "gateway") {
      if (
        !this.provider.gatewayHeaderName ||
        this.provider.gatewayHeaderValue === undefined
      ) {
        throw new ProviderError(
          "Bedrock gateway mode: gatewayHeader missing.",
          "bedrock",
        );
      }
      headers[this.provider.gatewayHeaderName] = this.provider.gatewayHeaderValue;
    } else {
      // access-key SigV4 mode.
      if (!this.provider.awsAccessKey || !this.provider.awsSecretKey) {
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
          accessKeyId: this.provider.awsAccessKey,
          secretAccessKey: this.provider.awsSecretKey,
          sessionToken: this.provider.awsSessionToken,
        },
      });
      const response = await requestUrl({
        url: signed.url,
        method: signed.method,
        headers: signed.headers,
        body: bodyStr,
        throw: false,
      });
      return parseAnthropicResponse(response, this.model.modelId, this.providerType);
    }

    const request: RequestUrlParam = {
      url,
      method: "POST",
      headers,
      body: JSON.stringify(body),
      throw: false,
    };
    const response = await requestUrl(request);
    return parseAnthropicResponse(response, this.model.modelId, this.providerType);
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
      `${providerType} ${response.status}: ${scrubAwsError(response.text)}`,
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
