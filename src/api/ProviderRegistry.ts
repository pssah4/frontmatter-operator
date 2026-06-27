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
      return new OpenAICompatibleProvider(provider, model, {
        baseUrlOverride: "https://api.individual.githubcopilot.com",
        overrideToken: token,
        extraHeaders: {
          "Editor-Version": "vscode/1.95.0",
          "Editor-Plugin-Version": "frontmatter-editor/0.1",
          "Copilot-Integration-Id": "vscode-chat",
        },
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
      return new OpenAICompatibleProvider(provider, model, {
        baseUrlOverride: "https://api.kilo.ai/api/openai",
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
      return new OpenAICompatibleProvider(provider, model, {
        baseUrlOverride: "https://api.openai.com/v1",
        overrideToken: token,
      });
    }

    default:
      throw new ProviderError(
        `Unknown provider type: ${(provider as { type: string }).type}`,
        (provider as ProviderConfig).type,
      );
  }
}
