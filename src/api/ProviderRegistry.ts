import type { ProviderConfig } from "../types/llm";
import { ProviderError } from "../types/llm";
import { AnthropicProvider } from "./providers/AnthropicProvider";
import { OpenAICompatibleProvider } from "./providers/OpenAICompatibleProvider";
import type { ApiHandler } from "./types";

export function buildApiHandler(config: ProviderConfig): ApiHandler {
  switch (config.type) {
    case "anthropic":
      return new AnthropicProvider(config);
    case "openai":
    case "openrouter":
    case "custom":
      return new OpenAICompatibleProvider(config);
    default: {
      throw new ProviderError(
        `Unknown provider type: ${(config as { type: string }).type}`,
        (config as ProviderConfig).type,
      );
    }
  }
}
