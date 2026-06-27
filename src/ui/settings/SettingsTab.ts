import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import type FrontmatterEditorPlugin from "../../main";
import {
  GENERATOR_LANGUAGE_LABELS,
  GENERATOR_LANGUAGES,
  DEFAULT_PRESETS,
} from "../../types/generators";
import {
  PROVIDER_COLORS,
  PROVIDER_LABELS,
  type ProviderConfig,
} from "../../types/llm";
import { ProviderDetailModal } from "./ProviderDetailModal";

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

    if (this.plugin.settings.providers.length === 0) {
      containerEl.createDiv({
        cls: "fm-editor-condition-empty",
        text: "No providers configured yet. Click + Add provider to start.",
      });
    }

    const table = containerEl.createDiv({ cls: "fm-editor-models-table" });
    for (const p of this.plugin.settings.providers) {
      this.renderProviderRow(table, p);
    }

    new Setting(containerEl).addButton((b) => {
      b.setCta()
        .setButtonText("+ Add provider")
        .onClick(() => {
          new ProviderDetailModal(this.app, this.plugin, null, () =>
            this.display(),
          ).open();
        });
    });
  }

  private renderProviderRow(parent: HTMLElement, provider: ProviderConfig): void {
    const row = parent.createDiv({ cls: "fm-editor-model-row" });
    if (!provider.enabled) row.addClass("is-disabled");
    if (provider.id === this.plugin.settings.defaultProviderId) {
      row.addClass("is-default");
    }

    const badge = row.createDiv({ cls: "fm-editor-model-badge" });
    badge.setText(PROVIDER_LABELS[provider.type]);
    badge.style.setProperty(
      "background-color",
      PROVIDER_COLORS[provider.type] ?? "#999",
    );

    const main = row.createDiv({ cls: "fm-editor-model-main" });
    main.createDiv({
      cls: "fm-editor-model-name",
      text: provider.displayName,
    });
    const cached = provider.discoveredModels?.length ?? 0;
    main.createDiv({
      cls: "fm-editor-model-sub",
      text: cached === 0
        ? "no discovery yet"
        : `${cached} cached model${cached === 1 ? "" : "s"}`,
    });

    const actions = row.createDiv({ cls: "fm-editor-model-actions" });

    const defaultBtn = actions.createEl("button", {
      cls:
        provider.id === this.plugin.settings.defaultProviderId
          ? "fm-editor-btn fm-editor-btn-primary"
          : "fm-editor-btn",
    });
    defaultBtn.setText(
      provider.id === this.plugin.settings.defaultProviderId
        ? "Default"
        : "Make default",
    );
    defaultBtn.disabled = !provider.enabled;
    defaultBtn.addEventListener("click", async () => {
      this.plugin.settings.defaultProviderId = provider.id;
      await this.plugin.saveSettings();
      this.display();
    });

    const enableLabel = actions.createEl("label", { cls: "fm-editor-checkbox-line" });
    const enableInput = enableLabel.createEl("input", { type: "checkbox" });
    enableInput.checked = provider.enabled;
    enableLabel.appendText("Enabled");
    enableInput.addEventListener("change", async () => {
      provider.enabled = enableInput.checked;
      if (!enableInput.checked && this.plugin.settings.defaultProviderId === provider.id) {
        this.plugin.settings.defaultProviderId =
          this.plugin.settings.providers.find((p) => p.id !== provider.id && p.enabled)
            ?.id ?? null;
      }
      await this.plugin.saveSettings();
      this.display();
    });

    const editBtn = actions.createEl("button", { cls: "fm-editor-btn" });
    setIcon(editBtn.createSpan(), "settings");
    editBtn.createSpan({ text: "Edit" });
    editBtn.addEventListener("click", () => {
      new ProviderDetailModal(this.app, this.plugin, provider, () => this.display()).open();
    });

    const delBtn = actions.createEl("button", {
      cls: "fm-editor-btn fm-editor-btn-destructive",
    });
    setIcon(delBtn.createSpan(), "trash-2");
    delBtn.addEventListener("click", async () => {
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

    const sysSetting = new Setting(parent)
      .setName("System prompt")
      .setDesc("Deterministic guardrail.");
    sysSetting.controlEl.style.display = "block";
    sysSetting.controlEl.style.width = "100%";
    const sysTa = sysSetting.controlEl.createEl("textarea", {
      cls: "fm-editor-generator-textarea",
      text: preset.prompts[lang].systemPrompt,
    });
    sysTa.rows = 6;
    sysTa.addEventListener("change", async () => {
      preset.prompts[lang].systemPrompt = sysTa.value;
      await this.plugin.saveSettings();
    });

    const userSetting = new Setting(parent)
      .setName("User prompt")
      .setDesc("Variables: {{NOTE_BODY}}, {{NOTE_TITLE}}, {{KNOWN_TOPICS}}, {{KNOWN_CONCEPTS}}.");
    userSetting.controlEl.style.display = "block";
    userSetting.controlEl.style.width = "100%";
    const userTa = userSetting.controlEl.createEl("textarea", {
      cls: "fm-editor-generator-textarea",
      text: preset.prompts[lang].userPrompt,
    });
    userTa.rows = 10;
    userTa.addEventListener("change", async () => {
      preset.prompts[lang].userPrompt = userTa.value;
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
