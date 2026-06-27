import type FrontmatterEditorPlugin from "../main";
import type { CustomModel } from "../types/llm";
import { ProviderError } from "../types/llm";
import { AnthropicProvider } from "./providers/AnthropicProvider";
import { OpenAICompatibleProvider } from "./providers/OpenAICompatibleProvider";
import { GeminiProvider } from "./providers/GeminiProvider";
import { BedrockProvider } from "./providers/BedrockProvider";
import type { ApiHandler } from "./types";

/**
 * Build the runtime handler for a given CustomModel. For OAuth-based
 * providers (GitHub Copilot, ChatGPT, Kilo) the plugin instance is used to
 * fetch the current bearer token.
 */
export async function buildApiHandler(
  model: CustomModel,
  plugin?: FrontmatterEditorPlugin,
): Promise<ApiHandler> {
  switch (model.provider) {
    case "anthropic":
      return new AnthropicProvider(model);

    case "gemini":
      return new GeminiProvider(model);

    case "bedrock":
      return new BedrockProvider(model);

    case "openai":
    case "ollama":
    case "lmstudio":
    case "openrouter":
    case "azure":
    case "custom":
      return new OpenAICompatibleProvider(model);

    case "github-copilot": {
      if (!plugin) {
        throw new ProviderError(
          "GitHub Copilot needs a plugin instance for token refresh.",
          model.provider,
        );
      }
      const token = await plugin.copilotAuth.getValidCopilotToken();
      if (!token) {
        throw new ProviderError(
          "GitHub Copilot is not authorized. Open Settings → Frontmatter Editor → models → edit this model → Sign in.",
          model.provider,
        );
      }
      return new OpenAICompatibleProvider(
        { ...model, baseUrl: "https://api.individual.githubcopilot.com" },
        {
          overrideToken: token,
          extraHeaders: {
            "Editor-Version": "vscode/1.95.0",
            "Editor-Plugin-Version": "frontmatter-editor/0.1",
            "Copilot-Integration-Id": "vscode-chat",
          },
        },
      );
    }

    case "kilo-gateway": {
      if (!plugin) {
        throw new ProviderError(
          "Kilo Gateway needs a plugin instance.",
          model.provider,
        );
      }
      const token = plugin.kiloAuth.getToken();
      if (!token) {
        throw new ProviderError(
          "Kilo Gateway is not authorized. Sign in from the model config modal.",
          model.provider,
        );
      }
      const extraHeaders: Record<string, string> = {};
      const orgId = plugin.kiloAuth.getOrgId();
      if (orgId) extraHeaders["X-KiloCode-OrganizationId"] = orgId;
      return new OpenAICompatibleProvider(
        { ...model, baseUrl: "https://api.kilo.ai/api/openai" },
        { overrideToken: token, extraHeaders },
      );
    }

    case "chatgpt-oauth": {
      if (!plugin) {
        throw new ProviderError(
          "ChatGPT OAuth needs a plugin instance.",
          model.provider,
        );
      }
      const token = await plugin.chatgptAuth.getValidAccessToken();
      if (!token) {
        throw new ProviderError(
          "ChatGPT is not authorized. Sign in from the model config modal.",
          model.provider,
        );
      }
      return new OpenAICompatibleProvider(
        {
          ...model,
          baseUrl: "https://api.openai.com/v1",
        },
        { overrideToken: token },
      );
    }

    default: {
      throw new ProviderError(
        `Unknown provider type: ${(model as { provider: string }).provider}`,
        (model as CustomModel).provider,
      );
    }
  }
}
