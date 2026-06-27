import { requestUrl } from "obsidian";
import type FrontmatterEditorPlugin from "../main";
import type { CustomModel, ProviderType } from "../types/llm";
import { DEFAULT_BASE_URLS } from "../types/llm";

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
  draft: CustomModel,
  plugin: FrontmatterEditorPlugin,
): Promise<FetchResult> {
  try {
    switch (draft.provider) {
      case "openai":
      case "openrouter":
      case "custom":
      case "lmstudio":
      case "azure":
        return await fetchOpenAICompatible(draft, plugin, draft.provider);
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
        return {
          ok: false,
          models: [],
          error:
            "Bedrock model discovery requires the AWS SDK ListInferenceProfiles call (next phase). Use the Quick-pick suggestions or paste the profile id manually.",
        };
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
  draft: CustomModel,
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

async function fetchOllama(draft: CustomModel): Promise<FetchResult> {
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

async function fetchGemini(draft: CustomModel): Promise<FetchResult> {
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

async function fetchAnthropic(draft: CustomModel): Promise<FetchResult> {
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
