/**
 * BedrockProvider -- ported 1:1 from Vault Operator.
 *
 * Uses the unified AWS SDK Converse API (ConverseCommand for non-streaming
 * generation) so the same code path works for Claude, Nova, Llama, Mistral.
 *
 * Three authentication modes, identical to VO:
 *   1. api-key  -- Bedrock API key (bearer). clientConfig.token +
 *                  authSchemePreference: ['httpBearerAuth'].
 *   2. access-key -- IAM access key + secret + optional session token (STS / SSO);
 *                  SDK signs each request with SigV4.
 *   3. gateway  -- enterprise proxy with a custom subscription header.
 *                  Dummy creds + middleware strips AWS-signing headers and
 *                  injects the static header. Uses NodeHttpHandler to bypass
 *                  Electron's window.fetch CORS.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type BedrockRuntimeClientConfig,
  type Message as BedrockMessage,
  type SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type {
  CompletionRequest,
  CompletionResult,
  ProviderConfig,
  RunModelOptions,
} from "../../types/llm";
import { ProviderError, recommendedMaxTokens } from "../../types/llm";
import type { ApiHandler } from "../types";

const DEFAULT_GATEWAY_HEADER_NAME = "Ocp-Apim-Subscription-Key";

export function applyGatewayHeaderTransform(
  request: { headers: Record<string, string> },
  headerName: string,
  headerValue: string,
): void {
  for (const key of Object.keys(request.headers)) {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower.startsWith("x-amz-")) {
      delete request.headers[key];
    }
  }
  request.headers[headerName] = headerValue;
}

export function extractRegionFromBedrockUrl(
  url: string | undefined,
): string | null {
  if (!url) return null;
  const match = url.match(
    /^https?:\/\/(?:[^.]+\.)?([a-z]{2}-[a-z]+-\d+)\.amazonaws\.com/i,
  );
  return match ? match[1].toLowerCase() : null;
}

export class BedrockProvider implements ApiHandler {
  readonly providerType = "bedrock";
  private client: BedrockRuntimeClient;

  constructor(
    private provider: ProviderConfig,
    private model: RunModelOptions,
  ) {
    const authMode = provider.awsAuthMode ?? "api-key";

    const region =
      authMode === "gateway"
        ? provider.awsRegion?.trim() || ""
        : provider.awsRegion?.trim() ||
          extractRegionFromBedrockUrl(provider.baseUrl) ||
          "";
    if (!region) {
      throw new ProviderError(
        "Bedrock: awsRegion is required (e.g. eu-central-1). Either pick a region or give an endpoint URL containing one.",
        "bedrock",
      );
    }

    const clientConfig: BedrockRuntimeClientConfig = {
      region,
      ...(provider.baseUrl?.trim() ? { endpoint: provider.baseUrl.trim() } : {}),
      // Gateway mode: route via Node http handler (bypasses Electron's
      // window.fetch CORS that enterprise gateways typically reject).
      ...(authMode === "gateway"
        ? { requestHandler: new NodeHttpHandler() }
        : {}),
    };

    if (authMode === "api-key") {
      const apiKey = provider.awsApiKey?.trim();
      if (!apiKey) {
        throw new ProviderError(
          "Bedrock: API key is required when authMode is api-key.",
          "bedrock",
        );
      }
      clientConfig.token = { token: apiKey };
      clientConfig.authSchemePreference = ["httpBearerAuth"];
    } else if (authMode === "access-key") {
      const accessKeyId = provider.awsAccessKey?.trim();
      const secretAccessKey = provider.awsSecretKey?.trim();
      if (!accessKeyId || !secretAccessKey) {
        throw new ProviderError(
          "Bedrock: awsAccessKey and awsSecretKey are required when authMode is access-key.",
          "bedrock",
        );
      }
      clientConfig.credentials = {
        accessKeyId,
        secretAccessKey,
        ...(provider.awsSessionToken
          ? { sessionToken: provider.awsSessionToken.trim() }
          : {}),
      };
    } else {
      // gateway
      const headerValue = provider.gatewayHeaderValue?.trim();
      if (!headerValue) {
        throw new ProviderError(
          "Bedrock: gatewayHeaderValue is required when authMode is gateway.",
          "bedrock",
        );
      }
      clientConfig.credentials = {
        accessKeyId: "frontmatter-editor-gateway",
        secretAccessKey: "frontmatter-editor-gateway",
      };
    }

    this.client = new BedrockRuntimeClient(clientConfig);

    if (authMode === "gateway") {
      const headerName =
        provider.gatewayHeaderName?.trim() || DEFAULT_GATEWAY_HEADER_NAME;
      const headerValue = provider.gatewayHeaderValue!.trim();
      this.client.middlewareStack.add(
        (next) => async (args) => {
          const request = (
            args as { request?: { headers?: Record<string, string> } }
          ).request;
          if (request && request.headers) {
            applyGatewayHeaderTransform(
              request as { headers: Record<string, string> },
              headerName,
              headerValue,
            );
          }
          return next(args);
        },
        {
          step: "finalizeRequest",
          name: "frontmatter-editor-gateway-auth",
          priority: "low",
        },
      );
    }
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const messages: BedrockMessage[] = req.messages.map((m) => ({
      role: m.role,
      content: [{ text: m.content }],
    }));

    const system: SystemContentBlock[] = req.systemPrompt
      ? [{ text: req.systemPrompt }]
      : [];

    const maxTokens =
      req.maxTokens ??
      this.model.maxTokens ??
      recommendedMaxTokens(this.model.modelId);

    const temperature = req.temperature ?? this.model.temperature ?? 0;

    const command = new ConverseCommand({
      modelId: this.model.modelId,
      messages,
      system: system.length > 0 ? system : undefined,
      inferenceConfig: {
        maxTokens,
        temperature,
      },
    });

    try {
      const response = await this.client.send(command, {
        abortSignal: req.abortSignal,
      });
      const text =
        response.output?.message?.content
          ?.filter((c) => c.text)
          .map((c) => c.text ?? "")
          .join("") ?? "";
      return {
        text,
        usage: {
          inputTokens: response.usage?.inputTokens,
          outputTokens: response.usage?.outputTokens,
        },
        model: this.model.modelId,
      };
    } catch (err) {
      // SDK errors carry $metadata + name; surface the short form.
      const message =
        err instanceof Error
          ? `${err.name}: ${err.message}`
          : String(err);
      throw new ProviderError(`Bedrock: ${message}`, "bedrock");
    }
  }

  async ping(): Promise<
    { ok: true; model: string } | { ok: false; error: string }
  > {
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
