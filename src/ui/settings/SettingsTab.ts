import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import type FrontmatterEditorPlugin from "../../main";
import {
  GENERATOR_LANGUAGE_LABELS,
  GENERATOR_LANGUAGES,
  DEFAULT_PRESETS,
} from "../../types/generators";
import { PROVIDER_LABELS, type ProviderConfig } from "../../types/llm";
import { ProviderDetailModal } from "./ProviderDetailModal";

/**
 * Per-row credentials probe. Mirrors VO providerHasCredentials
 * (src/ui/settings/ProvidersTab.ts:272-286). The check-icon / minus
 * column reads this -- a row with a check icon "has a credential";
 * minus = "no credential set".
 */
function providerHasCredentials(p: ProviderConfig): boolean {
  if (p.type === "ollama" || p.type === "lmstudio" || p.type === "custom") {
    return !!p.baseUrl?.trim();
  }
  if (p.type === "bedrock") {
    if (p.awsApiKey?.trim()) return true;
    return !!(p.awsAccessKey?.trim() && p.awsSecretKey?.trim());
  }
  if (p.type === "github-copilot" || p.type === "chatgpt-oauth") {
    return true; // OAuth state is tracked on the plugin, not the row -- VO does the same
  }
  return !!p.apiKey?.trim();
}

export class FrontmatterEditorSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: FrontmatterEditorPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("fm-editor-settings");

    this.renderProvidersSection();
    this.renderGeneratorsSection();
  }

  private renderProvidersSection(): void {
    const { containerEl } = this;

    new Setting(containerEl).setName("LLM providers").setHeading();

    containerEl.createDiv({
      cls: "fm-editor-modal-hint",
      text: "One provider account per row. The AI chat (Generate with AI from a column header) picks the provider and concrete model at run time. 12 provider types are supported.",
    });

    // VO-style 5-column grid: Provider | Key | Enable | Default | Actions.
    // Same DOM + CSS class set as Vault Operator's ProvidersTab so the
    // look + feel stays identical (model-table providers-table).
    const table = containerEl.createDiv({
      cls: "model-table providers-table",
    });
    const header = table.createDiv({ cls: "model-row model-row-header" });
    header.createDiv({ cls: "mc-name", text: "Provider" });
    header.createDiv({ cls: "mc-key", text: "Key" });
    header.createDiv({ cls: "mc-enable", text: "Enable" });
    header.createDiv({ cls: "mc-default", text: "Default" });
    header.createDiv({ cls: "mc-actions" });

    const providers = this.plugin.settings.providers ?? [];
    if (providers.length === 0) {
      table.createDiv({
        cls: "model-table-empty",
        text: "No providers configured yet. Click + Add provider below.",
      });
    } else {
      for (const p of providers) this.renderProviderRow(table, p);
    }

    const footer = containerEl.createDiv({ cls: "model-table-footer" });
    const addBtn = footer.createEl("button", {
      cls: "mod-cta model-add-btn",
      text: "+ Add provider",
    });
    addBtn.addEventListener("click", () => {
      new ProviderDetailModal(this.app, this.plugin, null, () =>
        this.display(),
      ).open();
    });
  }

  private renderProviderRow(parent: HTMLElement, provider: ProviderConfig): void {
    const isActive = provider.id === this.plugin.settings.defaultProviderId;
    const rowCls = [
      "model-row",
      isActive ? "model-row-active" : "",
      !provider.enabled ? "model-row-disabled" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const row = parent.createDiv(rowCls);

    // ---- Provider name + sub-line (model count) ----
    const nameEl = row.createDiv("mc-name");
    nameEl.createSpan({
      text: provider.displayName || PROVIDER_LABELS[provider.type],
      cls: "mc-name-text",
    });
    const sub = this.rowSummary(provider);
    if (sub) {
      const subEl = nameEl.createDiv({ cls: "mc-name-sub" });
      subEl.setText(sub);
    }

    // ---- Key indicator (check / minus icon) ----
    const hasKey = providerHasCredentials(provider);
    const keyEl = row.createDiv("mc-key");
    const keyIcon = keyEl.createSpan({ cls: "mc-key-icon" });
    setIcon(keyIcon, hasKey ? "check" : "minus");
    keyEl.addClass(hasKey ? "mc-key-ok" : "mc-key-missing");

    // ---- Enable toggle (custom checkbox + track) ----
    const enableEl = row.createDiv("mc-enable");
    const toggleLabel = enableEl.createEl("label", { cls: "mc-toggle" });
    const toggleInput = toggleLabel.createEl("input", {
      attr: { type: "checkbox" },
    });
    toggleLabel.createSpan({ cls: "mc-toggle-track" });
    toggleInput.checked = provider.enabled;
    toggleInput.addEventListener("change", async () => {
      provider.enabled = toggleInput.checked;
      // Disabling the active provider clears the default slot so the
      // chat picker doesn't keep pointing at a disabled row -- same
      // behavior as VO ProvidersTab.ts:178-191.
      if (
        !toggleInput.checked &&
        this.plugin.settings.defaultProviderId === provider.id
      ) {
        this.plugin.settings.defaultProviderId = null;
      }
      await this.plugin.saveSettings();
      this.display();
    });

    // ---- Default radio (single-pick across all rows) ----
    const defaultEl = row.createDiv("mc-default");
    const defaultRadio = defaultEl.createEl("input", {
      attr: { type: "radio", name: "active-provider" },
    });
    defaultRadio.checked = isActive;
    defaultRadio.disabled = !provider.enabled;
    defaultRadio.addEventListener("change", async () => {
      if (defaultRadio.checked) {
        this.plugin.settings.defaultProviderId = provider.id;
        await this.plugin.saveSettings();
        this.display();
      }
    });

    // ---- Actions: gear (configure) + trash (remove) ----
    const actionsEl = row.createDiv("mc-actions");
    const configBtn = actionsEl.createEl("button", {
      cls: "mc-action-btn",
      attr: { title: "Configure" },
    });
    setIcon(configBtn, "settings");
    configBtn.addEventListener("click", () => {
      new ProviderDetailModal(this.app, this.plugin, provider, () =>
        this.display(),
      ).open();
    });
    const delBtn = actionsEl.createEl("button", {
      cls: "mc-action-btn mc-action-del",
      attr: { title: "Remove" },
    });
    setIcon(delBtn, "trash");
    delBtn.addEventListener("click", async () => {
      const ok = window.confirm(
        `Remove provider "${provider.displayName || PROVIDER_LABELS[provider.type]}"?`,
      );
      if (!ok) return;
      this.plugin.settings.providers = this.plugin.settings.providers.filter(
        (p) => p.id !== provider.id,
      );
      if (this.plugin.settings.defaultProviderId === provider.id) {
        this.plugin.settings.defaultProviderId =
          this.plugin.settings.providers.find((p) => p.enabled)?.id ?? null;
      }
      await this.plugin.saveSettings();
      this.display();
    });
  }

  /**
   * Sub-line text shown under the provider name, mirroring VO's
   * rowSummary (ProvidersTab.ts:253-263). Disabled providers get a
   * static label; enabled providers with no discovery yet ask for a
   * Refresh; otherwise the discovery count plus the default-model
   * label so the user sees the chat pick at a glance.
   */
  private rowSummary(provider: ProviderConfig): string {
    if (!provider.enabled) return "Disabled";
    const cached = provider.discoveredModels ?? [];
    if (cached.length === 0) {
      return "No discovery yet -- click Edit and Refresh in Discovery.";
    }
    const defaultModelId =
      this.plugin.settings.lastUsedModelByProvider?.[provider.id];
    const defaultLabel = defaultModelId
      ? cached.find((m) => m.id === defaultModelId)?.label ?? defaultModelId
      : "no default picked";
    return `${cached.length} models  ·  default: ${defaultLabel}`;
  }

  private renderGeneratorsSection(): void {
    const { containerEl } = this;

    new Setting(containerEl).setName("Generators").setHeading();

    new Setting(containerEl)
      .setName("Prompt language")
      .setDesc(
        "Language used for the built-in generator prompts. Custom edits are preserved per language.",
      )
      .addDropdown((d) => {
        for (const lang of GENERATOR_LANGUAGES) {
          d.addOption(lang, GENERATOR_LANGUAGE_LABELS[lang]);
        }
        d.setValue(this.plugin.settings.generatorLanguage);
        d.onChange(async (value) => {
          this.plugin.settings.generatorLanguage = value as "en" | "de";
          await this.plugin.saveSettings();
          this.display();
        });
      });

    for (const preset of this.plugin.settings.presets) {
      this.renderPresetSection(containerEl, preset);
    }
    this.renderCustomPromptsSection();
  }

  private renderPresetSection(
    parent: HTMLElement,
    preset: (typeof this.plugin.settings.presets)[number],
  ): void {
    const head = new Setting(parent)
      .setName(preset.displayName)
      .setDesc(`${preset.description}  ·  writes to \`${preset.targetProperty}\``);
    head.addButton((b) => {
      b.setButtonText("Reset prompts to default")
        .setWarning()
        .onClick(async () => {
          const fresh = DEFAULT_PRESETS.find((p) => p.id === preset.id);
          if (!fresh) return;
          const idx = this.plugin.settings.presets.findIndex((p) => p.id === preset.id);
          if (idx >= 0) {
            this.plugin.settings.presets[idx] = JSON.parse(JSON.stringify(fresh));
            await this.plugin.saveSettings();
            this.display();
            new Notice(`Reset prompt for ${preset.displayName}`);
          }
        });
    });

    const lang = this.plugin.settings.generatorLanguage;

    // Single prompt per property per language. The fixed safety
    // guardrail (output-only policy + UNABLE_TO_GENERATE sentinel)
    // is non-user-editable and prepended automatically by the
    // GeneratorService -- see types/generators.ts GENERATOR_GUARDRAIL.
    const promptSetting = new Setting(parent)
      .setName("Prompt")
      .setDesc(
        "Instruction sent to the LLM per note. Variables: {{NOTE_BODY}}, {{NOTE_TITLE}}, {{KNOWN_TOPICS}}, {{KNOWN_CONCEPTS}}. A fixed safety guardrail (refusal sentinel, output-only policy) is appended automatically; you don't need to write it yourself.",
      );
    promptSetting.controlEl.style.display = "block";
    promptSetting.controlEl.style.width = "100%";
    const promptTa = promptSetting.controlEl.createEl("textarea", {
      cls: "fm-editor-generator-textarea",
      text: preset.prompts[lang],
    });
    promptTa.rows = 14;
    promptTa.addEventListener("change", async () => {
      preset.prompts[lang] = promptTa.value;
      await this.plugin.saveSettings();
    });
  }

  private renderCustomPromptsSection(): void {
    const { containerEl } = this;

    new Setting(containerEl).setName("Custom prompts").setHeading();

    containerEl.createDiv({
      cls: "fm-editor-modal-hint",
      text: "Saved ad-hoc prompts. Created from the Generate-with-AI modal (Save as custom prompt).",
    });

    if (this.plugin.settings.customPrompts.length === 0) {
      containerEl.createDiv({
        cls: "fm-editor-condition-empty",
        text: "No custom prompts yet.",
      });
      return;
    }

    for (const tpl of this.plugin.settings.customPrompts) {
      const row = new Setting(containerEl)
        .setName(tpl.name)
        .setDesc(`target: \`${tpl.targetProperty}\`  ·  parser: ${tpl.parser}`);
      row.addButton((b) => {
        b.setButtonText("Rename").onClick(async () => {
          const next = window.prompt("Rename custom prompt", tpl.name);
          if (!next) return;
          tpl.name = next;
          await this.plugin.saveSettings();
          this.display();
        });
      });
      row.addButton((b) => {
        b.setIcon("trash-2").setWarning().onClick(async () => {
          this.plugin.settings.customPrompts =
            this.plugin.settings.customPrompts.filter((p) => p.id !== tpl.id);
          await this.plugin.saveSettings();
          this.display();
        });
      });
    }
  }
}
