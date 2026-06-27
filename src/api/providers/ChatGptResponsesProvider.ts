import { requestUrl } from "obsidian";
import type FrontmatterEditorPlugin from "../../main";
import type {
  CompletionRequest,
  CompletionResult,
  ProviderConfig,
  RunModelOptions,
} from "../../types/llm";
import { ProviderError, recommendedMaxTokens } from "../../types/llm";
import type { ApiHandler } from "../types";

/**
 * ChatGPT OAuth provider -- speaks the **codex-cli Responses API**, NOT the
 * regular OpenAI chat/completions endpoint. Endpoint, body shape and headers
 * are all different.
 *
 * Mirrors VO's chatgpt-oauth provider.
 *
 *   POST https://chatgpt.com/backend-api/codex/responses
 *   Body: { model, instructions, input: [...], store: false, reasoning?, temperature? }
 *   Headers: OpenAI-Beta, Originator, User-Agent (load-bearing), Authorization,
 *            chatgpt-account-id, ChatGPT-Account-ID
 *
 * The User-Agent version is gated server-side; stale versions get an old
 * model set, new models 400 as "not supported".
 */

const ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_VERSION = "codex_cli_rs/0.140.0";

interface ResponsesInputItem {
  type: "message";
  role: "user" | "assistant" | "system";
  content: Array<{
    type: "input_text" | "output_text";
    text: string;
  }>;
}

interface ResponsesBody {
  model: string;
  instructions: string;
  input: ResponsesInputItem[];
  store: false;
  stream?: boolean;
  parallel_tool_calls?: false;
  reasoning?: { effort: "minimal" | "low" | "medium" | "high"; summary?: "auto" };
  include?: string[];
  temperature?: number;
}

export class ChatGptResponsesProvider implements ApiHandler {
  readonly providerType = "chatgpt-oauth";

  constructor(
    private provider: ProviderConfig,
    private model: RunModelOptions,
    private plugin: FrontmatterEditorPlugin,
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const token = await this.plugin.chatgptAuth.getValidAccessToken();
    if (!token) {
      throw new ProviderError(
        "ChatGPT is not authorized. Sign in from the provider config.",
        "chatgpt-oauth",
      );
    }
    const accountId = this.plugin.settings.chatgptOAuthAccountId ?? "";

    const input: ResponsesInputItem[] = req.messages.map((m) => ({
      type: "message",
      role: m.role,
      content: [
        {
          type: m.role === "assistant" ? "output_text" : "input_text",
          text: m.content,
        },
      ],
    }));

    const isGpt5 = /^gpt-5/i.test(this.model.modelId);
    const body: ResponsesBody = {
      model: this.model.modelId,
      instructions: req.systemPrompt,
      input,
      store: false,
      parallel_tool_calls: false,
    };

    if (isGpt5) {
      const effort = (this.model.reasoningEffort ?? "medium") as
        | "low"
        | "medium"
        | "high";
      body.reasoning = { effort, summary: "auto" };
      body.include = ["reasoning.encrypted_content"];
    } else if (this.model.temperature !== undefined || req.temperature !== undefined) {
      body.temperature = req.temperature ?? this.model.temperature;
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "OpenAI-Beta": "responses=experimental",
      Originator: "codex_cli_rs",
      "User-Agent": `${CODEX_VERSION} (Obsidian Plugin) Frontmatter Editor`,
    };
    if (accountId) {
      headers["chatgpt-account-id"] = accountId;
      headers["ChatGPT-Account-ID"] = accountId;
    }

    const response = await requestUrl({
      url: ENDPOINT,
      method: "POST",
      headers,
      body: JSON.stringify(body),
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ProviderError(
        `ChatGPT ${response.status}: ${shortError(response.json ?? response.text)}`,
        "chatgpt-oauth",
        response.status,
      );
    }

    const json = response.json as ResponsesResponse;
    const text = extractText(json);
    return {
      text,
      usage: {
        inputTokens: json.usage?.input_tokens,
        outputTokens: json.usage?.output_tokens,
      },
      model: json.model ?? this.model.modelId,
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

interface ResponsesResponse {
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  output_text?: string;
}

function extractText(json: ResponsesResponse): string {
  // VO: prefer the convenience aggregate when present.
  if (json.output_text) return json.output_text;
  if (!json.output) return "";
  let out = "";
  for (const item of json.output) {
    if (item.type !== "message") continue;
    for (const block of item.content ?? []) {
      if (block.type === "output_text" && block.text) out += block.text;
    }
  }
  return out;
}

function shortError(payload: unknown): string {
  if (!payload) return "";
  if (typeof payload === "string") return payload.slice(0, 280);
  const obj = payload as { error?: { message?: string }; message?: string };
  return (obj.error?.message ?? obj.message ?? JSON.stringify(payload)).slice(0, 280);
}
