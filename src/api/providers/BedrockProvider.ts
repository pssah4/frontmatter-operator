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
import { assertValidHeader } from "../headerValidation";

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
      // L-4 SAST (AUDIT 2026-06-29): validate RFC 7230 token name +
      // printable-ASCII value at construction so a fat-finger header
      // name surfaces a clean error instead of an opaque Node
      // TypeError mid-request. Also blocks Host / Content-Length /
      // Authorization overrides.
      try {
        assertValidHeader(headerName, headerValue);
      } catch (err) {
        throw new ProviderError(
          `Bedrock gateway header invalid: ${err instanceof Error ? err.message : String(err)}`,
          "bedrock",
        );
      }
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
      throw enhanceBedrockError(
        err,
        this.model.modelId,
        this.provider.awsRegion ?? "us-east-1",
      );
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

/**
 * Translate AWS SDK errors into actionable ProviderError messages.
 * The default SDK message is technically correct but cryptic for users
 * who hit the most common failure modes: model-access not granted,
 * model unavailable in region, on-demand throughput required, account
 * not authorized. Each branch adds a one-line hint with the exact next
 * step (e.g. the AWS console URL for model access in the user's region).
 */
export function enhanceBedrockError(
  err: unknown,
  modelId: string,
  region: string,
): ProviderError {
  if (!(err instanceof Error)) {
    return new ProviderError(`Bedrock: ${String(err)}`, "bedrock");
  }
  const name = err.name || "Error";
  const msg = err.message || String(err);
  const lower = msg.toLowerCase();

  // Access denied / model-access not granted in the AWS console.
  if (
    name === "AccessDeniedException" ||
    lower.includes("don't have access") ||
    lower.includes("not authorized to perform")
  ) {
    return new ProviderError(
      `Bedrock: ${name}: ${msg}\n\nFix: enable model access for "${modelId}" in the AWS Bedrock console -> https://${region}.console.aws.amazon.com/bedrock/home?region=${region}#/modelaccess`,
      "bedrock",
    );
  }

  // Bare-model-id on-demand: AWS asks for an inference profile instead.
  if (
    name === "ValidationException" &&
    lower.includes("on-demand throughput isn't supported")
  ) {
    return new ProviderError(
      `Bedrock: ${name}: ${msg}\n\nFix: open the provider modal, click Re-refresh in Discovery, and pick an inference profile id (prefix eu./us./ap./...). Bare ids require provisioned throughput.`,
      "bedrock",
    );
  }

  // Model not available in this region or doesn't exist on Bedrock.
  if (
    name === "ValidationException" &&
    (lower.includes("not available") ||
      lower.includes("not found") ||
      lower.includes("does not exist") ||
      lower.includes("invalid model"))
  ) {
    return new ProviderError(
      `Bedrock: ${name}: ${msg}\n\nFix: model "${modelId}" is not available in ${region}. Open the provider modal, click Re-refresh in Discovery, and pick a model from the updated list.`,
      "bedrock",
    );
  }

  // Generic 400 -- often "model not enabled for this account" without
  // an explicit access-denied wording. Surface the AWS message verbatim
  // and add the console link as a likely-fix hint.
  if (name === "ValidationException") {
    return new ProviderError(
      `Bedrock: ${name}: ${msg}\n\nIf the model id looks correct, check that it's enabled for your account at https://${region}.console.aws.amazon.com/bedrock/home?region=${region}#/modelaccess and that your AWS region (${region}) actually hosts this model.`,
      "bedrock",
    );
  }

  if (name === "ThrottlingException" || name === "TooManyRequestsException") {
    return new ProviderError(
      `Bedrock: ${name}: ${msg}\n\nFix: AWS is rate-limiting. Wait a moment and retry, or request a quota increase in the AWS console.`,
      "bedrock",
    );
  }

  if (name === "UnrecognizedClientException") {
    return new ProviderError(
      `Bedrock: ${name}: ${msg}\n\nFix: the AWS credentials are invalid or expired. Re-enter API key / Access key in the provider modal.`,
      "bedrock",
    );
  }

  return new ProviderError(`Bedrock: ${name}: ${msg}`, "bedrock");
}
