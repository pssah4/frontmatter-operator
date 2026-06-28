import { requestUrl } from "obsidian";
import type FrontmatterEditorPlugin from "../main";
import type { ProviderConfig, ProviderType } from "../types/llm";
import { DEFAULT_BASE_URLS, MODEL_SUGGESTIONS } from "../types/llm";
import { signSigV4 } from "../auth/AwsSigV4";

export interface FetchedModel {
  id: string;
  label: string;
  group?: string;
}

export interface FetchResult {
  ok: boolean;
  models: FetchedModel[];
  error?: string;
}

/**
 * Live discovery of available models for a configured (provider, baseUrl,
 * credentials) tuple. Returns an empty list with `ok: false` and a message
 * when the provider does not expose a discovery endpoint or the request
 * fails.
 */
export async function fetchModels(
  draft: ProviderConfig,
  plugin: FrontmatterEditorPlugin,
): Promise<FetchResult> {
  try {
    switch (draft.type) {
      case "openai":
      case "openrouter":
      case "custom":
      case "lmstudio":
      case "azure":
        return await fetchOpenAICompatible(draft, plugin, draft.type);
      case "ollama":
        return await fetchOllama(draft);
      case "gemini":
        return await fetchGemini(draft);
      case "anthropic":
        return await fetchAnthropic(draft);
      case "github-copilot":
        return await fetchGitHubCopilot(plugin);
      case "kilo-gateway":
        return await fetchKilo(plugin);
      case "chatgpt-oauth":
        return await fetchChatGptOAuth(plugin);
      case "bedrock":
        return await fetchBedrock(draft);
      default:
        return { ok: false, models: [], error: "Unsupported provider" };
    }
  } catch (err) {
    return {
      ok: false,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------- OPENAI-LIKE

async function fetchOpenAICompatible(
  draft: ProviderConfig,
  plugin: FrontmatterEditorPlugin,
  provider: ProviderType,
): Promise<FetchResult> {
  const baseUrl = (
    draft.baseUrl ?? DEFAULT_BASE_URLS[provider] ?? ""
  ).replace(/\/+$/, "");
  if (!baseUrl) {
    return { ok: false, models: [], error: "No base URL configured." };
  }

  const url =
    provider === "azure"
      ? `${baseUrl}/openai/models?api-version=${draft.apiVersion ?? "2024-10-21"}`
      : `${baseUrl}/models`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (draft.apiKey) headers["Authorization"] = `Bearer ${draft.apiKey}`;
  if (provider === "openrouter") {
    headers["HTTP-Referer"] =
      "https://github.com/pssah4/frontmatter-editor-dev";
    headers["X-Title"] = "Frontmatter Editor";
  }

  const resp = await requestUrl({ url, method: "GET", headers, throw: false });
  if (resp.status >= 300) {
    return {
      ok: false,
      models: [],
      error: `HTTP ${resp.status}: ${truncate(resp.text)}`,
    };
  }

  const json = resp.json as {
    data?: Array<{ id: string; name?: string; owned_by?: string }>;
    models?: Array<{ id: string; name?: string }>;
  };
  const list = json.data ?? json.models ?? [];
  const models: FetchedModel[] = list.map((m) => ({
    id: m.id,
    label: m.name ?? m.id,
    group: filterGroupForOpenAI(provider, m.id, (m as { owned_by?: string }).owned_by),
  }));
  // For chat use, drop embeddings / audio / image / realtime / tts models that
  // sneak into /v1/models.
  const filtered = provider === "openai" ? models.filter(isChatId) : models;
  return { ok: true, models: filtered.sort(byGroupThenId) };
}

function isChatId(m: FetchedModel): boolean {
  const id = m.id.toLowerCase();
  if (
    id.includes("embedding") ||
    id.includes("whisper") ||
    id.includes("tts") ||
    id.includes("dall-e") ||
    id.includes("realtime") ||
    id.includes("audio") ||
    id.includes("transcribe") ||
    id.includes("davinci")
  )
    return false;
  return true;
}

function filterGroupForOpenAI(
  provider: ProviderType,
  id: string,
  ownedBy?: string,
): string | undefined {
  if (provider === "openrouter") {
    const slash = id.indexOf("/");
    if (slash > -1) return id.slice(0, slash);
  }
  if (ownedBy) return ownedBy;
  return undefined;
}

// ---------------------------------------------------------------- OLLAMA

async function fetchOllama(draft: ProviderConfig): Promise<FetchResult> {
  const baseUrl = (draft.baseUrl ?? DEFAULT_BASE_URLS.ollama!).replace(
    /\/+$/,
    "",
  );
  const url = `${baseUrl}/api/tags`;
  const resp = await requestUrl({ url, method: "GET", throw: false });
  if (resp.status >= 300) {
    return {
      ok: false,
      models: [],
      error: `Ollama HTTP ${resp.status}: ${truncate(resp.text)}`,
    };
  }
  const json = resp.json as { models?: Array<{ name: string; model?: string }> };
  const models: FetchedModel[] = (json.models ?? []).map((m) => ({
    id: m.model ?? m.name,
    label: m.name,
    group: "Installed",
  }));
  return { ok: true, models };
}

// ---------------------------------------------------------------- GEMINI

async function fetchGemini(draft: ProviderConfig): Promise<FetchResult> {
  if (!draft.apiKey) {
    return { ok: false, models: [], error: "Gemini needs an API key." };
  }
  const base = (draft.baseUrl ?? DEFAULT_BASE_URLS.gemini!)
    .replace(/\/openai\/?$/, "")
    .replace(/\/+$/, "");
  const url = `${base}/models?key=${encodeURIComponent(draft.apiKey)}&pageSize=200`;
  const resp = await requestUrl({ url, method: "GET", throw: false });
  if (resp.status >= 300) {
    return {
      ok: false,
      models: [],
      error: `Gemini HTTP ${resp.status}: ${truncate(resp.text)}`,
    };
  }
  const json = resp.json as {
    models?: Array<{
      name?: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    }>;
  };
  const models: FetchedModel[] = (json.models ?? [])
    .filter((m) =>
      (m.supportedGenerationMethods ?? []).includes("generateContent"),
    )
    .map((m) => {
      const id = (m.name ?? "").replace(/^models\//, "");
      return {
        id,
        label: m.displayName ?? id,
        group: id.startsWith("gemini-2.5")
          ? "Gemini 2.5"
          : id.startsWith("gemini-2.0")
            ? "Gemini 2.0"
            : "Other",
      };
    });
  return { ok: true, models: models.sort(byGroupThenId) };
}

// ---------------------------------------------------------------- ANTHROPIC

async function fetchAnthropic(draft: ProviderConfig): Promise<FetchResult> {
  if (!draft.apiKey) {
    return { ok: false, models: [], error: "Anthropic needs an API key." };
  }
  const base = (draft.baseUrl ?? DEFAULT_BASE_URLS.anthropic!).replace(
    /\/+$/,
    "",
  );
  const url = `${base}/v1/models`;
  const resp = await requestUrl({
    url,
    method: "GET",
    headers: {
      "anthropic-version": "2023-06-01",
      "x-api-key": draft.apiKey,
      Accept: "application/json",
    },
    throw: false,
  });
  if (resp.status >= 300) {
    return {
      ok: false,
      models: [],
      error: `Anthropic HTTP ${resp.status}: ${truncate(resp.text)}`,
    };
  }
  const json = resp.json as {
    data?: Array<{ id: string; display_name?: string; created_at?: string }>;
  };
  const models: FetchedModel[] = (json.data ?? []).map((m) => ({
    id: m.id,
    label: m.display_name ?? m.id,
    group: m.id.includes("opus")
      ? "Opus"
      : m.id.includes("sonnet")
        ? "Sonnet"
        : "Haiku",
  }));
  return { ok: true, models: models.sort(byGroupThenId) };
}

// ---------------------------------------------------------------- COPILOT

async function fetchGitHubCopilot(
  plugin: FrontmatterEditorPlugin,
): Promise<FetchResult> {
  const token = await plugin.copilotAuth.getValidCopilotToken();
  if (!token) {
    return {
      ok: false,
      models: [],
      error: "Sign in first.",
    };
  }
  const resp = await requestUrl({
    url: "https://api.individual.githubcopilot.com/models",
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Editor-Version": "vscode/1.95.0",
      "Editor-Plugin-Version": "frontmatter-editor/0.1",
      "Copilot-Integration-Id": "vscode-chat",
    },
    throw: false,
  });
  if (resp.status >= 300) {
    return {
      ok: false,
      models: [],
      error: `Copilot HTTP ${resp.status}: ${truncate(resp.text)}`,
    };
  }
  const json = resp.json as {
    data?: Array<{
      id: string;
      name?: string;
      vendor?: string;
      capabilities?: { family?: string };
    }>;
  };
  const models: FetchedModel[] = (json.data ?? []).map((m) => ({
    id: m.id,
    label: m.name ?? m.id,
    group: m.vendor ?? m.capabilities?.family ?? "Other",
  }));
  return { ok: true, models: models.sort(byGroupThenId) };
}

// ---------------------------------------------------------------- KILO

async function fetchKilo(
  plugin: FrontmatterEditorPlugin,
): Promise<FetchResult> {
  const token = plugin.kiloAuth.getToken();
  if (!token) {
    return { ok: false, models: [], error: "Sign in first." };
  }
  const resp = await requestUrl({
    url: "https://api.kilo.ai/api/openai/models",
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    throw: false,
  });
  if (resp.status >= 300) {
    return {
      ok: false,
      models: [],
      error: `Kilo HTTP ${resp.status}: ${truncate(resp.text)}`,
    };
  }
  const json = resp.json as {
    data?: Array<{ id: string; name?: string }>;
  };
  const models: FetchedModel[] = (json.data ?? []).map((m) => ({
    id: m.id,
    label: m.name ?? m.id,
    group: "Kilo",
  }));
  return { ok: true, models };
}

// ---------------------------------------------------------------- CHATGPT OAUTH

async function fetchChatGptOAuth(
  plugin: FrontmatterEditorPlugin,
): Promise<FetchResult> {
  const token = await plugin.chatgptAuth.getValidAccessToken();
  if (!token) {
    return { ok: false, models: [], error: "Sign in first." };
  }
  // The ChatGPT OAuth endpoint exposes /v1/models but it filters by plan tier
  // server-side, so we still post-filter to chat-capable ids.
  const resp = await requestUrl({
    url: "https://api.openai.com/v1/models",
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    throw: false,
  });
  if (resp.status >= 300) {
    return {
      ok: false,
      models: [],
      error: `OpenAI HTTP ${resp.status}: ${truncate(resp.text)}`,
    };
  }
  const json = resp.json as {
    data?: Array<{ id: string; owned_by?: string }>;
  };
  const models: FetchedModel[] = (json.data ?? [])
    .map((m) => ({
      id: m.id,
      label: m.id,
      group: m.owned_by ?? "OpenAI",
    }))
    .filter(isChatId);
  return { ok: true, models: models.sort(byGroupThenId) };
}

// ---------------------------------------------------------------- BEDROCK

async function fetchBedrock(draft: ProviderConfig): Promise<FetchResult> {
  const authMode = draft.awsAuthMode ?? "api-key";
  const region = draft.awsRegion?.trim() ?? "eu-central-1";

  // Lazy-import the SDKs so the bundle does not load them when the user
  // never opens a Bedrock provider modal.
  const { BedrockClient, ListInferenceProfilesCommand, ListFoundationModelsCommand } =
    await import("@aws-sdk/client-bedrock");

  type ClientConfig = ConstructorParameters<typeof BedrockClient>[0];
  const clientConfig: ClientConfig = { region };

  if (authMode === "api-key") {
    const apiKey = draft.awsApiKey?.trim();
    if (!apiKey) {
      return {
        ok: false,
        models: [],
        error:
          "Bedrock api-key mode: paste the bearer token first, then click Refresh.",
      };
    }
    clientConfig.token = { token: apiKey };
    clientConfig.authSchemePreference = ["httpBearerAuth"];
  } else if (authMode === "access-key") {
    const accessKeyId = draft.awsAccessKey?.trim();
    const secretAccessKey = draft.awsSecretKey?.trim();
    if (!accessKeyId || !secretAccessKey) {
      return {
        ok: false,
        models: [],
        error:
          "Bedrock access-key mode: accessKey and secretKey required.",
      };
    }
    clientConfig.credentials = {
      accessKeyId,
      secretAccessKey,
      ...(draft.awsSessionToken ? { sessionToken: draft.awsSessionToken.trim() } : {}),
    };
  } else {
    return {
      ok: false,
      models: [],
      error:
        "Gateway mode does not expose discovery endpoints. Switch to api-key or access-key mode to refresh.",
    };
  }

  const client = new BedrockClient(clientConfig);

  // Run both list calls in parallel via the SDK.
  const [profilesResult, foundationResult] = await Promise.all([
    listInferenceProfiles(
      client,
      ListInferenceProfilesCommand,
    ).catch((err: Error) => ({
      ok: false as const,
      error: err.message,
      list: [] as FetchedModel[],
    })),
    listFoundationModels(
      client,
      ListFoundationModelsCommand,
    ).catch((err: Error) => ({
      ok: false as const,
      error: err.message,
      list: [] as FetchedModel[],
    })),
  ]);

  const merged: FetchedModel[] = [
    ...(profilesResult.list ?? []),
    ...(foundationResult.list ?? []),
  ];
  if (merged.length === 0) {
    const errs: string[] = [];
    if ("error" in profilesResult && profilesResult.error)
      errs.push(`profiles: ${profilesResult.error}`);
    if ("error" in foundationResult && foundationResult.error)
      errs.push(`foundation: ${foundationResult.error}`);
    return {
      ok: false,
      models: [],
      error: errs.join(" · ") || "no models returned",
    };
  }
  const seen = new Set<string>();
  const unique = merged.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  return { ok: true, models: unique.sort(byBedrockPriority) };
}

/**
 * Bedrock-specific ordering for the picker. Goal: after Refresh, the
 * first entry is one we know works -- a model from VO's curated
 * MODEL_SUGGESTIONS list. Without this gate the dropdown's top slot
 * was filling with the latest-listed AWS model (e.g. Opus 4.8) even
 * when the user's AWS account had no access to it, surfacing
 * "ValidationException: You don't have access to model ..." on the
 * very first Generate.
 *
 * Order rules:
 *   1. Inference-profile-prefixed ids (eu./us./...) before bare ids.
 *      Bare amazon.nova-* / meta.llama* ids cannot be invoked with
 *      on-demand throughput in most regions.
 *   2. Within profile-class, model families that appear in
 *      MODEL_SUGGESTIONS.bedrock (curated, known to work on every
 *      enabled AWS account) win over uncurated ids -- so Opus 4.6
 *      beats Opus 4.8 until 4.8 is explicitly added to the curated
 *      list.
 *   3. Vendor priority: anthropic > amazon (nova) > meta > mistral
 *      > cohere > ai21 > others.
 *   4. Lex descending on id, so 4-6-v1 sorts before 4-5-v1.
 */
function byBedrockPriority(a: FetchedModel, b: FetchedModel): number {
  const ap = bedrockProfilePriority(a.id);
  const bp = bedrockProfilePriority(b.id);
  if (ap !== bp) return ap - bp;
  const as = bedrockSuggestionPriority(a.id);
  const bs = bedrockSuggestionPriority(b.id);
  if (as !== bs) return as - bs;
  const av = bedrockVendorPriority(a.id);
  const bv = bedrockVendorPriority(b.id);
  if (av !== bv) return av - bv;
  return b.id.localeCompare(a.id);
}

function bedrockProfilePriority(id: string): number {
  // Inference profile prefixes get priority 0, bare ids get 1.
  return /^[a-z]{2}\./i.test(id) ? 0 : 1;
}

function bedrockVendorPriority(id: string): number {
  const tail = id.replace(/^[a-z]{2}\./i, "");
  if (tail.startsWith("anthropic.")) return 0;
  if (tail.startsWith("amazon.nova")) return 1;
  if (tail.startsWith("meta.llama")) return 2;
  if (tail.startsWith("mistral.")) return 3;
  if (tail.startsWith("cohere.")) return 4;
  if (tail.startsWith("ai21.")) return 5;
  return 9;
}

/**
 * Strip trailing version suffix from a Bedrock id so two ids referring
 * to the same model family compare equal. Handles:
 *   eu.anthropic.claude-opus-4-6-v1   -> eu.anthropic.claude-opus-4-6
 *   eu.anthropic.claude-opus-4-6-v1:0 -> eu.anthropic.claude-opus-4-6
 *   anthropic.claude-3-5-sonnet-20241022-v2:0
 *                                     -> anthropic.claude-3-5-sonnet-20241022
 *   amazon.nova-pro-v1:0              -> amazon.nova-pro
 * AWS sometimes returns the version-less form in ListInferenceProfiles
 * and the versioned form in ListFoundationModels. Our static
 * MODEL_SUGGESTIONS use one or the other; family-key normalization
 * lets the picker match both.
 */
export function bedrockFamilyKey(id: string): string {
  return id
    .replace(/[-:]v\d+(:\d+)?$/i, "")
    .replace(/:\d+$/, "");
}

const SUGGESTED_BEDROCK_FAMILIES: ReadonlySet<string> = new Set(
  MODEL_SUGGESTIONS.bedrock.map((s) => bedrockFamilyKey(s.id)),
);

function bedrockSuggestionPriority(id: string): number {
  return SUGGESTED_BEDROCK_FAMILIES.has(bedrockFamilyKey(id)) ? 0 : 1;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime SDK types are deep generics; we treat them as a thin send-handle here
async function listInferenceProfiles(
  client: any,
  ListInferenceProfilesCommand: any,
): Promise<{ ok: true; list: FetchedModel[] } | { ok: false; error: string; list: FetchedModel[] }> {
  const list: FetchedModel[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const cmd = new ListInferenceProfilesCommand({
      maxResults: 1000,
      typeEquals: "SYSTEM_DEFINED",
      ...(nextToken ? { nextToken } : {}),
    });
    const response = (await client.send(cmd)) as {
      inferenceProfileSummaries?: Array<{
        inferenceProfileId?: string;
        inferenceProfileName?: string;
        status?: string;
      }>;
      nextToken?: string;
    };
    for (const p of response.inferenceProfileSummaries ?? []) {
      if ((p.status ?? "ACTIVE") !== "ACTIVE") continue;
      if (!p.inferenceProfileId) continue;
      // Inference profiles route to the same underlying foundation models,
      // so the family denylist applies just as well -- a cross-region
      // profile id like 'us.amazon.nova-canvas-v1:0' must not slip through.
      if (!isConverseCompatibleId(p.inferenceProfileId)) continue;
      list.push({
        id: p.inferenceProfileId,
        label: p.inferenceProfileName ?? p.inferenceProfileId,
        group: groupForBedrockId(p.inferenceProfileId, "Inference profile"),
      });
    }
    if (!response.nextToken) break;
    nextToken = response.nextToken;
  }
  return { ok: true, list };
}

/**
 * Bedrock id patterns to drop from the picker even when AWS returns them
 * in TEXT-output mode. ConverseCommand rejects every entry below with
 * ValidationException: "This action doesn't support the model that you
 * provided. Try again with a supported text or chat model." Patterns
 * are case-insensitive substring matches on the model id.
 */
export const BEDROCK_NON_CONVERSE_DENYLIST: ReadonlyArray<{
  pattern: RegExp;
  reason: string;
}> = [
  { pattern: /cohere\.embed/i, reason: "Cohere embeddings -- embeddings API only" },
  { pattern: /amazon\.titan-embed/i, reason: "Titan embeddings -- embeddings API only" },
  { pattern: /amazon\.titan-image/i, reason: "Titan Image Generator -- image-gen API only" },
  { pattern: /amazon\.nova-canvas/i, reason: "Nova Canvas -- image generation" },
  { pattern: /amazon\.nova-reel/i, reason: "Nova Reel -- video generation" },
  { pattern: /amazon\.nova-sonic/i, reason: "Nova Sonic -- speech-to-speech" },
  { pattern: /amazon\.rerank/i, reason: "Amazon Rerank -- reranking API" },
  { pattern: /cohere\.rerank/i, reason: "Cohere Rerank -- reranking API" },
  { pattern: /stability\./i, reason: "Stability SD/SDXL -- image generation" },
  { pattern: /stable-diffusion/i, reason: "Stable Diffusion variant -- image generation" },
  { pattern: /ai21\.jamba-instruct/i, reason: "AI21 Jamba Instruct legacy -- InvokeModel only" },
  { pattern: /ai21\.j2-/i, reason: "AI21 Jurassic-2 legacy -- InvokeModel only" },
  { pattern: /contextual-answers/i, reason: "AI21 contextual-answers -- task-specific endpoint" },
  { pattern: /summarize|paraphrase/i, reason: "AI21 task-specific endpoints" },
  { pattern: /guardrail/i, reason: "Bedrock Guardrails -- policy enforcement" },
  { pattern: /meta\.llama2-/i, reason: "Llama 2 family -- predates Converse" },
  { pattern: /cohere\.command-(?:text|light-text)/i, reason: "Cohere Command legacy -- InvokeModel only" },
  { pattern: /transcribe|whisper|tts|speech/i, reason: "Speech models -- not Converse" },
];

export function isConverseCompatibleId(modelId: string): boolean {
  for (const { pattern } of BEDROCK_NON_CONVERSE_DENYLIST) {
    if (pattern.test(modelId)) return false;
  }
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime SDK types are deep generics
async function listFoundationModels(
  client: any,
  ListFoundationModelsCommand: any,
): Promise<{ ok: true; list: FetchedModel[] } | { ok: false; error: string; list: FetchedModel[] }> {
  // Server-side gate 1: byOutputModality=TEXT drops image-gen / video-gen
  // / speech models AWS-side, so the response doesn't even ship them. VO
  // (testModelConnection.ts:721) does the same.
  const cmd = new ListFoundationModelsCommand({ byOutputModality: "TEXT" });
  const response = (await client.send(cmd)) as {
    modelSummaries?: Array<{
      modelId?: string;
      modelName?: string;
      providerName?: string;
      inferenceTypesSupported?: string[];
      inputModalities?: string[];
      outputModalities?: string[];
      modelLifecycle?: { status?: string };
      responseStreamingSupported?: boolean;
    }>;
  };
  const list: FetchedModel[] = (response.modelSummaries ?? [])
    // Belt-and-suspenders: keep only TEXT-output even if AWS shipped a
    // mis-tagged entry (Stability SD models occasionally slip through
    // byOutputModality=TEXT depending on region).
    .filter((m) => (m.outputModalities ?? ["TEXT"]).includes("TEXT"))
    // Some image-edit models accept only IMAGE input -- the Converse
    // API needs at least TEXT input.
    .filter((m) => (m.inputModalities ?? ["TEXT"]).includes("TEXT"))
    // Provisioned-throughput-only models cannot be invoked from Converse
    // without standing up dedicated capacity. ON_DEMAND and
    // INFERENCE_PROFILE both work; PROVISIONED alone does not.
    .filter((m) => {
      const types = m.inferenceTypesSupported ?? ["ON_DEMAND"];
      return types.includes("ON_DEMAND") || types.includes("INFERENCE_PROFILE");
    })
    // Drop LEGACY models -- AWS keeps listing them but Converse 400s.
    .filter((m) => (m.modelLifecycle?.status ?? "ACTIVE") === "ACTIVE")
    // Family denylist for known non-Converse model classes that occasionally
    // pass the TEXT-modality filter (rerank, contextual-answers, etc.).
    .filter((m) => (m.modelId ? isConverseCompatibleId(m.modelId) : false))
    .map((m) => ({
      id: m.modelId ?? "",
      label: m.modelName ?? m.modelId ?? "",
      group: m.providerName ?? groupForBedrockId(m.modelId ?? "", "Foundation"),
    }))
    .filter((p) => p.id.length > 0);
  return { ok: true, list };
}

function groupForBedrockId(id: string, fallback: string): string {
  if (id.includes("anthropic")) return "Anthropic";
  if (id.includes("amazon.nova") || id.includes("amazon.titan")) return "Amazon";
  if (id.includes("meta.llama")) return "Meta";
  if (id.includes("mistral")) return "Mistral";
  if (id.includes("cohere")) return "Cohere";
  return fallback;
}

/**
 * Strip AWS-side leak vectors from error bodies before they bubble into
 * Notices / console logs. AWS SignatureDoesNotMatch responses include the
 * full canonical request (which contains accessKeyId, signed-headers
 * structure and timestamp). IncompleteSignature messages include the
 * Authorization header verbatim. None of that belongs in a user-facing
 * error string.
 */
export function scrubAwsError(text: string): string {
  if (!text) return "";
  let scrubbed = text
    .replace(/Credential=[^,\s]+/g, "Credential=<redacted>")
    .replace(/Signature=[a-f0-9]+/gi, "Signature=<redacted>")
    .replace(/x-amz-security-token:[^\n]+/gi, "x-amz-security-token:<redacted>")
    .replace(/AKIA[A-Z0-9]{16}/g, "AKIA<redacted>")
    .replace(/ASIA[A-Z0-9]{16}/g, "ASIA<redacted>");
  // Try to parse and surface only AWS error envelope short fields.
  try {
    const json = JSON.parse(scrubbed) as {
      __type?: string;
      message?: string;
      Message?: string;
    };
    if (json.__type || json.message || json.Message) {
      const code = json.__type ?? "AwsError";
      const msg = json.message ?? json.Message ?? "";
      return `${code}${msg ? ": " + msg.slice(0, 200) : ""}`;
    }
  } catch {
    /* not JSON -- fall through */
  }
  // XML envelope -- pick Code + first Message.
  const codeMatch = scrubbed.match(/<Code>([^<]+)<\/Code>/);
  const msgMatch = scrubbed.match(/<Message>([^<]+)<\/Message>/);
  if (codeMatch) {
    return `${codeMatch[1]}${msgMatch ? ": " + msgMatch[1].slice(0, 200) : ""}`;
  }
  return scrubbed.length > 280 ? scrubbed.slice(0, 280) + "..." : scrubbed;
}

// ---------------------------------------------------------------- helpers

function byGroupThenId(a: FetchedModel, b: FetchedModel): number {
  const g = (a.group ?? "").localeCompare(b.group ?? "");
  if (g !== 0) return g;
  return a.id.localeCompare(b.id);
}

function truncate(s: string): string {
  if (!s) return "";
  return s.length > 280 ? s.slice(0, 280) + "..." : s;
}
