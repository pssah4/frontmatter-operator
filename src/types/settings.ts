import type { CustomModel } from "./llm";
import type {
  CustomPromptTemplate,
  GeneratorLanguage,
  GeneratorPreset,
} from "./generators";
import { DEFAULT_PRESETS } from "./generators";

export interface FrontmatterEditorSettings {
  /** All configured models -- replaces the old providers[] bucket. */
  models: CustomModel[];
  /** Id of the model used by default in the generator modal. */
  defaultModelId: string | null;
  /** Language for the built-in preset prompts. */
  generatorLanguage: GeneratorLanguage;
  /** Built-in + user-added presets. Custom prompts override the defaults. */
  presets: GeneratorPreset[];
  /** Saved ad-hoc prompts grouped by target property. */
  customPrompts: CustomPromptTemplate[];

  // --- OAuth-managed credentials. Stored encrypted via SafeStorage when available.
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
  models: [],
  defaultModelId: null,
  generatorLanguage: "en",
  presets: DEFAULT_PRESETS,
  customPrompts: [],
};
