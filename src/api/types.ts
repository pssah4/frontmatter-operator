import type {
  CompletionRequest,
  CompletionResult,
  ProviderConfig,
} from "../types/llm";

/**
 * Minimal API handler interface. Property generation does not need
 * streaming or tool-use, so the contract is intentionally narrower than
 * Vault Operator's full ApiHandler.
 */
export interface ApiHandler {
  readonly providerType: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  /** A short "is this provider reachable" probe used by the settings test button. */
  ping(): Promise<{ ok: true; model: string } | { ok: false; error: string }>;
}

export type ApiHandlerFactory = (config: ProviderConfig) => ApiHandler;
