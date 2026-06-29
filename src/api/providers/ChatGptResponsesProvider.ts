/**
 * ChatGptResponsesProvider -- ported 1:1 from Vault Operator.
 *
 * Talks to https://chatgpt.com/backend-api/codex/responses (the Responses
 * API endpoint codex-cli uses). NOT chat/completions.
 *
 * Uses the Node `https` module directly because chatgpt.com refuses
 * browser-fetch requests without an Origin matching one of the OpenAI
 * domains. NodeHttpHandler bypass would work but pulls a lot of deps;
 * the raw `https.request` from VO is the smallest viable transport.
 *
 * Streams Server-Sent Events; we accumulate response.output_text.delta
 * chunks into the final text and pick up usage from response.completed.
 */

import { Platform } from "obsidian";
import type FrontmatterEditorPlugin from "../../main";
import type {
  CompletionRequest,
  CompletionResult,
  ProviderConfig,
  RunModelOptions,
} from "../../types/llm";
import { ProviderError } from "../../types/llm";
import type { ApiHandler } from "../types";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_CLIENT_VERSION = "0.140.0";

/**
 * First-party originator + user-agent. The Codex backend rejects everything
 * outside this allowlist with 403 + "no active subscription". Verified
 * against pi-mono#1828 and codex-rs.
 *
 * User-Agent version is load-bearing: the backend gates the available model
 * set on the reported client version. A stale version is served the old
 * (now-removed) model set, so every current model 400s as "not supported".
 */
const CODEX_HEADERS: Record<string, string> = {
  "OpenAI-Beta": "responses=experimental",
  Originator: "codex_cli_rs",
  "User-Agent": `codex_cli_rs/${CODEX_CLIENT_VERSION} (Obsidian Plugin) Frontmatter Editor`,
  Accept: "text/event-stream",
};

interface ResponsesInputItem {
  type: "message";
  role: "user" | "assistant" | "system";
  content: Array<{ type: "input_text" | "output_text"; text: string }>;
}

interface ResponsesRequestBody {
  model: string;
  instructions?: string;
  input: ResponsesInputItem[];
  stream: true;
  store: false;
  reasoning?: { effort: "minimal" | "low" | "medium" | "high"; summary?: "auto" };
  include?: string[];
  temperature?: number;
}

type Effort = "minimal" | "low" | "medium" | "high";
const GPT_EFFORT_LEVELS: Effort[] = ["minimal", "low", "medium", "high"];

function isGpt5Family(modelId: string): boolean {
  return /^gpt-5(\b|[.-])/i.test(modelId);
}

function resolveGptEffort(level: string | undefined): Effort {
  return GPT_EFFORT_LEVELS.find((v) => v === level) ?? "low";
}

interface NodeStreamResponse {
  status: number;
  headers: Record<string, string>;
  stream: AsyncIterable<Buffer>;
}

export class ChatGptResponsesProvider implements ApiHandler {
  readonly providerType = "chatgpt-oauth";

  constructor(
    private provider: ProviderConfig,
    private model: RunModelOptions,
    private plugin: FrontmatterEditorPlugin,
  ) {
    // L-1 ZT (AUDIT 2026-06-29): the Codex backend requires raw
    // Node `https` (loaded via window.require) for SSE streaming;
    // Obsidian's `requestUrl` cannot stream and window.require is
    // a desktop-only Electron API. On mobile this throws a
    // confusing "require is not a function" mid-call. Fail clean
    // at construction so the user sees a clear setting-level
    // error instead.
    if (Platform.isMobile) {
      throw new ProviderError(
        "ChatGPT (OAuth) requires desktop Obsidian -- the Codex backend streams Server-Sent Events that the mobile transport cannot handle. Use a different provider for mobile.",
        "chatgpt-oauth",
      );
    }
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
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

    const body: ResponsesRequestBody = {
      model: this.model.modelId,
      instructions: req.systemPrompt,
      input,
      stream: true,
      store: false,
    };

    if (isGpt5Family(this.model.modelId)) {
      // The Codex backend rejects GPT-5* requests without a reasoning field.
      body.reasoning = {
        effort: resolveGptEffort(this.model.reasoningEffort),
        summary: "auto",
      };
      body.include = ["reasoning.encrypted_content"];
    } else if (
      this.model.temperature !== undefined ||
      req.temperature !== undefined
    ) {
      body.temperature = Math.min(req.temperature ?? this.model.temperature ?? 0, 2.0);
    }

    let response = await this.streamRequest(body, req.abortSignal);
    if (response.status === 401) {
      this.plugin.chatgptAuth.invalidateAccessToken();
      response = await this.streamRequest(body, req.abortSignal);
    }
    if (response.status >= 400) {
      const detail = await readBody(response);
      throw enhanceError(response.status, detail, this.model.modelId);
    }

    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const event of parseSseEvents(response, req.abortSignal)) {
      if (event.type === "text") text += event.text;
      else if (event.type === "usage") {
        inputTokens = event.inputTokens;
        outputTokens = event.outputTokens;
      }
    }
    return {
      text,
      usage: { inputTokens, outputTokens },
      model: this.model.modelId,
    };
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

  private async streamRequest(
    body: ResponsesRequestBody,
    signal?: AbortSignal,
  ): Promise<NodeStreamResponse> {
    const token = await this.plugin.chatgptAuth.getValidAccessToken();
    if (!token) {
      throw new ProviderError(
        "ChatGPT is not signed in. Open the provider config and click Sign in.",
        "chatgpt-oauth",
      );
    }
    const accountId = this.plugin.chatgptAuth.getAccountId();
    const headers: Record<string, string> = {
      ...CODEX_HEADERS,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (accountId) {
      headers["chatgpt-account-id"] = accountId;
      headers["ChatGPT-Account-ID"] = accountId;
    }
    return openStream(CODEX_RESPONSES_URL, JSON.stringify(body), headers, signal);
  }
}

// --------------------------------------------------------- Node https transport

function openStream(
  url: string,
  body: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<NodeStreamResponse> {
  const parsed = new URL(url);
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Node https is the only Electron-renderer transport that bypasses CORS for chatgpt.com (same as VO)
  const https = (window as unknown as { require: (id: string) => unknown }).require(
    "https",
  ) as typeof import("https");

  return new Promise<NodeStreamResponse>((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        const responseHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v) responseHeaders[k] = Array.isArray(v) ? v.join(", ") : v;
        }
        const stream = (async function* () {
          for await (const chunk of res) {
            yield chunk as Buffer;
          }
        })();
        resolve({
          status: res.statusCode ?? 500,
          headers: responseHeaders,
          stream,
        });
      },
    );
    req.on("error", reject);
    if (signal) {
      const onAbort = () => {
        req.destroy();
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    req.write(body);
    req.end();
  });
}

async function readBody(response: NodeStreamResponse): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of response.stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// --------------------------------------------------------- SSE parser (port from VO)

type SseEvent =
  | { type: "text"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number };

async function* parseSseEvents(
  response: NodeStreamResponse,
  _signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of response.stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let eventEnd: number;
    while ((eventEnd = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, eventEnd);
      buffer = buffer.slice(eventEnd + 2);
      const parsed = parseSseBlock(rawEvent);
      if (!parsed) continue;
      yield* dispatchEvent(parsed.eventName, parsed.data);
    }
  }
}

function parseSseBlock(block: string): { eventName: string; data: string } | null {
  const lines = block.split("\n");
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  return { eventName, data: dataLines.join("\n") };
}

function* dispatchEvent(
  eventName: string,
  data: string,
): Generator<SseEvent> {
  if (data === "[DONE]") return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return;
  }
  const type = (parsed.type as string | undefined) ?? eventName;

  if (type === "response.output_text.delta") {
    const delta = parsed.delta;
    if (typeof delta === "string" && delta.length > 0) {
      yield { type: "text", text: delta };
    }
    return;
  }

  if (type === "response.completed") {
    const responseObj = parsed.response as Record<string, unknown> | undefined;
    const usage = responseObj?.usage as Record<string, unknown> | undefined;
    if (usage) {
      const inputTokens =
        toNum(usage.input_tokens) ?? toNum(usage.prompt_tokens) ?? 0;
      const outputTokens =
        toNum(usage.output_tokens) ?? toNum(usage.completion_tokens) ?? 0;
      yield { type: "usage", inputTokens, outputTokens };
    }
    return;
  }

  if (type === "response.failed") {
    const responseObj = parsed.response as Record<string, unknown> | undefined;
    const error = responseObj?.error as Record<string, unknown> | undefined;
    const message = (error?.message as string | undefined) ?? "response.failed";
    throw new Error(`ChatGPT response failed: ${message}`);
  }
  // response.created / response.in_progress / response.output_item.* are ignored.
}

function toNum(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function enhanceError(status: number, detail: string, modelId: string): Error {
  const trimmed = detail.length > 400 ? detail.slice(0, 400) + "..." : detail;
  const server = extractServerDetail(detail);
  if (status === 400) {
    if (
      server &&
      /not supported when using Codex with a ChatGPT account/i.test(server)
    ) {
      return new ProviderError(
        `ChatGPT subscription does not support model "${modelId}" on the Codex backend. Click Refresh in the provider settings to load the current model list.`,
        "chatgpt-oauth",
        400,
      );
    }
    return new ProviderError(
      `ChatGPT request rejected (400): ${server ?? trimmed}`,
      "chatgpt-oauth",
      400,
    );
  }
  if (status === 401) {
    return new ProviderError(
      "ChatGPT authentication failed. Open provider settings and sign in again.",
      "chatgpt-oauth",
      401,
    );
  }
  if (status === 403) {
    return new ProviderError(
      `ChatGPT subscription check failed (403): ${trimmed}`,
      "chatgpt-oauth",
      403,
    );
  }
  if (status === 429) {
    return new ProviderError(
      "ChatGPT rate limit reached. Try again in a moment.",
      "chatgpt-oauth",
      429,
    );
  }
  return new ProviderError(
    `ChatGPT API error (${status}): ${trimmed}`,
    "chatgpt-oauth",
    status,
  );
}

function extractServerDetail(body: string): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (typeof parsed.detail === "string") return parsed.detail;
    if (typeof parsed.message === "string") return parsed.message;
    const err = parsed.error;
    if (
      err &&
      typeof err === "object" &&
      typeof (err as Record<string, unknown>).message === "string"
    ) {
      return (err as Record<string, unknown>).message as string;
    }
  } catch {
    /* not JSON */
  }
  return undefined;
}
