import type { ProviderConfig } from "./llm";
import type {
  CustomPromptTemplate,
  GeneratorLanguage,
  GeneratorPreset,
} from "./generators";
import { DEFAULT_PRESETS } from "./generators";
import type { Filter, FilterCombinator } from "../types";

/** One column's persisted state inside a saved view. */
export interface SavedViewColumn {
  property: string;
  sort: "asc" | "desc" | null;
  filter: Filter | null;
}

/**
 * A named, restorable snapshot of the editor's working state: which columns are
 * visible (with sort + per-column filters), the global WHEN conditions, their
 * combinator, and the note-path filter. Applying a view rebuilds all of these.
 */
export interface SavedView {
  id: string;
  name: string;
  columns: SavedViewColumn[];
  globalFilters: Filter[];
  combinator: FilterCombinator;
  notePathFilter: string;
}

export interface FrontmatterEditorSettings {
  /** Provider accounts. Each one is an (identity + auth + discovery cache) tuple. */
  providers: ProviderConfig[];
  /** Default provider used by the AI chat / generator. */
  defaultProviderId: string | null;
  /** Sticky per-provider model picker: { providerId -> modelId }. */
  lastUsedModelByProvider: Record<string, string>;
  /** Language for the built-in preset prompts. */
  generatorLanguage: GeneratorLanguage;
  /** Built-in + custom-edited presets. */
  presets: GeneratorPreset[];
  /** Saved ad-hoc prompts grouped by target property. */
  customPrompts: CustomPromptTemplate[];
  /** Named, restorable column + filter + WHEN-condition layouts. */
  savedViews: SavedView[];

  // OAuth-managed credentials (encrypted via SafeStorage at rest).
  githubCopilotAccessToken?: string;
  githubCopilotToken?: string;
  githubCopilotTokenExpiresAt?: number;
  githubCopilotDeviceCode?: string;

  chatgptOAuthAccessToken?: string;
  chatgptOAuthRefreshToken?: string;
  chatgptOAuthIdToken?: string;
  chatgptOAuthAccountId?: string;
  chatgptOAuthEmail?: string;
  chatgptOAuthExpiresAt?: number;

  kiloToken?: string;
  kiloAuthMode?: "device-auth" | "manual-token" | "";
  kiloOrganizationId?: string;
}

export const DEFAULT_SETTINGS: FrontmatterEditorSettings = {
  providers: [],
  defaultProviderId: null,
  lastUsedModelByProvider: {},
  generatorLanguage: "en",
  presets: DEFAULT_PRESETS,
  customPrompts: [],
  savedViews: [],
};
