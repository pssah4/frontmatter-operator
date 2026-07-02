import type FrontmatterEditorPlugin from "../main";
import type { ProviderConfig, RunModelOptions } from "../types/llm";
import { ProviderError } from "../types/llm";
import { AnthropicProvider } from "./providers/AnthropicProvider";
import { OpenAICompatibleProvider } from "./providers/OpenAICompatibleProvider";
import { GeminiProvider } from "./providers/GeminiProvider";
import { BedrockProvider } from "./providers/BedrockProvider";
import type { ApiHandler } from "./types";

export async function buildApiHandler(
  provider: ProviderConfig,
  model: RunModelOptions,
  plugin?: FrontmatterEditorPlugin,
): Promise<ApiHandler> {
  switch (provider.type) {
    case "anthropic":
      return new AnthropicProvider(provider, model);

    case "gemini":
      return new GeminiProvider(provider, model);

    case "bedrock":
      return new BedrockProvider(provider, model);

    case "openai":
    case "ollama":
    case "lmstudio":
    case "openrouter":
    case "azure":
    case "custom":
      return new OpenAICompatibleProvider(provider, model);

    case "github-copilot": {
      if (!plugin) {
        throw new ProviderError(
          "GitHub Copilot needs a plugin instance for token refresh.",
          provider.type,
        );
      }
      const token = await plugin.copilotAuth.getValidCopilotToken();
      if (!token) {
        throw new ProviderError(
          "GitHub Copilot is not authorized. Sign in from the provider config.",
          provider.type,
        );
      }
      // VO uses api.githubcopilot.com (NOT api.individual.githubcopilot.com).
      // The chat-completions endpoint requires max_completion_tokens
      // and the full 6-header VS Code impersonation bundle (mirrors
      // the Codex User-Agent gate -- a stale value gets the request
      // rejected even with valid auth). Bundle ported 1:1 from VO
      // src/core/security/GitHubCopilotAuthService.ts:35-42.
      return new OpenAICompatibleProvider(provider, model, {
        baseUrlOverride: "https://api.githubcopilot.com",
        overrideToken: token,
        extraHeaders: {
          "User-Agent": "GitHubCopilotChat/0.39.2",
          "Editor-Version": "vscode/1.111.0",
          "Editor-Plugin-Version": "copilot-chat/0.39.2",
          "Copilot-Integration-Id": "vscode-chat",
          "Openai-Intent": "conversation-panel",
          "X-GitHub-Api-Version": "2025-10-01",
        },
        useMaxCompletionTokens: true,
      });
    }

    case "kilo-gateway": {
      if (!plugin) {
        throw new ProviderError(
          "Kilo Gateway needs a plugin instance.",
          provider.type,
        );
      }
      const token = plugin.kiloAuth.getToken();
      if (!token) {
        throw new ProviderError(
          "Kilo Gateway is not authorized. Sign in from the provider config.",
          provider.type,
        );
      }
      const extraHeaders: Record<string, string> = {};
      const orgId = plugin.kiloAuth.getOrgId();
      if (orgId) extraHeaders["X-KiloCode-OrganizationId"] = orgId;
      // VO uses /api/gateway (NOT /api/openai).
      return new OpenAICompatibleProvider(provider, model, {
        baseUrlOverride: "https://api.kilo.ai/api/gateway",
        overrideToken: token,
        extraHeaders,
      });
    }

    case "chatgpt-oauth": {
      if (!plugin) {
        throw new ProviderError(
          "ChatGPT OAuth needs a plugin instance.",
          provider.type,
        );
      }
      const token = await plugin.chatgptAuth.getValidAccessToken();
      if (!token) {
        throw new ProviderError(
          "ChatGPT is not authorized. Sign in from the provider config.",
          provider.type,
        );
      }
      // ChatGPT OAuth speaks the codex-cli Responses API, NOT chat/completions.
      // Different endpoint, different body shape; not OpenAI-compatible.
      const { ChatGptResponsesProvider } = await import(
        "./providers/ChatGptResponsesProvider"
      );
      return new ChatGptResponsesProvider(provider, model, plugin);
    }

    default:
      throw new ProviderError(
        `Unknown provider type: ${(provider as { type: string }).type}`,
        provider.type,
      );
  }
}
