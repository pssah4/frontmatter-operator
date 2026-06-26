import type { ProviderConfig } from "./llm";
import type { GeneratorLanguage, GeneratorPreset } from "./generators";
import { DEFAULT_PRESETS } from "./generators";

export interface FrontmatterEditorSettings {
  providers: ProviderConfig[];
  /** id of the provider used by default. */
  defaultProviderId: string | null;
  /** Language for the built-in preset prompts. */
  generatorLanguage: GeneratorLanguage;
  /** Custom prompt overrides per preset id (id matches DEFAULT_PRESETS[].id). */
  presets: GeneratorPreset[];
}

export const DEFAULT_SETTINGS: FrontmatterEditorSettings = {
  providers: [],
  defaultProviderId: null,
  generatorLanguage: "en",
  presets: DEFAULT_PRESETS,
};
