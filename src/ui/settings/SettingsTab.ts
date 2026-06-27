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
  type CustomModel,
} from "../../types/llm";
import { ModelConfigModal } from "./ModelConfigModal";

export class FrontmatterEditorSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: FrontmatterEditorPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("fm-editor-settings");

    this.renderModelsSection();
    this.renderGeneratorsSection();
  }

  // ----------------------------------------------------------- MODELS

  private renderModelsSection(): void {
    const { containerEl } = this;

    new Setting(containerEl).setName("LLM models").setHeading();

    containerEl.createDiv({
      cls: "fm-editor-modal-hint",
      text: "Each entry is one configured model: a (provider, model id, credentials, decode parameters) tuple. The generator picks from this list. All 12 providers are supported -- Anthropic, OpenAI, Gemini, Ollama, LM Studio, OpenRouter, Azure OpenAI, GitHub Copilot, Kilo Gateway, Amazon Bedrock, ChatGPT (OAuth), Custom (OpenAI-compatible).",
    });

    if (this.plugin.settings.models.length === 0) {
      containerEl.createDiv({
        cls: "fm-editor-condition-empty",
        text: "No models configured yet. Click + Add model to start.",
      });
    }

    const table = containerEl.createDiv({ cls: "fm-editor-models-table" });
    for (const model of this.plugin.settings.models) {
      this.renderModelRow(table, model);
    }

    new Setting(containerEl).addButton((b) => {
      b.setCta()
        .setButtonText("+ Add model")
        .onClick(() => {
          new ModelConfigModal(this.app, this.plugin, null, () =>
            this.display(),
          ).open();
        });
    });
  }

  private renderModelRow(parent: HTMLElement, model: CustomModel): void {
    const row = parent.createDiv({ cls: "fm-editor-model-row" });
    if (!model.enabled) row.addClass("is-disabled");
    if (model.id === this.plugin.settings.defaultModelId) {
      row.addClass("is-default");
    }

    const badge = row.createDiv({ cls: "fm-editor-model-badge" });
    badge.setText(PROVIDER_LABELS[model.provider]);
    badge.style.setProperty(
      "background-color",
      PROVIDER_COLORS[model.provider] ?? "#999",
    );

    const main = row.createDiv({ cls: "fm-editor-model-main" });
    main.createDiv({
      cls: "fm-editor-model-name",
      text: model.displayName || model.name,
    });
    main.createDiv({
      cls: "fm-editor-model-sub",
      text: model.displayName
        ? `${model.name}`
        : "",
    });

    const actions = row.createDiv({ cls: "fm-editor-model-actions" });

    // default-radio
    const defaultRadio = actions.createEl("button", {
      cls: model.id === this.plugin.settings.defaultModelId
        ? "fm-editor-btn fm-editor-btn-primary"
        : "fm-editor-btn",
    });
    defaultRadio.setText(
      model.id === this.plugin.settings.defaultModelId ? "Default" : "Make default",
    );
    defaultRadio.disabled = !model.enabled;
    defaultRadio.addEventListener("click", async () => {
      this.plugin.settings.defaultModelId = model.id;
      await this.plugin.saveSettings();
      this.display();
    });

    // enable toggle
    const enableLabel = actions.createEl("label", {
      cls: "fm-editor-checkbox-line",
    });
    const enableInput = enableLabel.createEl("input", { type: "checkbox" });
    enableInput.checked = model.enabled;
    enableLabel.appendText("Enabled");
    enableInput.addEventListener("change", async () => {
      model.enabled = enableInput.checked;
      if (!enableInput.checked && this.plugin.settings.defaultModelId === model.id) {
        this.plugin.settings.defaultModelId =
          this.plugin.settings.models.find((m) => m.id !== model.id && m.enabled)
            ?.id ?? null;
      }
      await this.plugin.saveSettings();
      this.display();
    });

    const editBtn = actions.createEl("button", { cls: "fm-editor-btn" });
    setIcon(editBtn.createSpan(), "settings");
    editBtn.createSpan({ text: "Edit" });
    editBtn.addEventListener("click", () => {
      new ModelConfigModal(this.app, this.plugin, model, () => this.display()).open();
    });

    const delBtn = actions.createEl("button", {
      cls: "fm-editor-btn fm-editor-btn-destructive",
    });
    setIcon(delBtn.createSpan(), "trash-2");
    delBtn.addEventListener("click", async () => {
      this.plugin.settings.models = this.plugin.settings.models.filter(
        (m) => m.id !== model.id,
      );
      if (this.plugin.settings.defaultModelId === model.id) {
        this.plugin.settings.defaultModelId =
          this.plugin.settings.models.find((m) => m.enabled)?.id ?? null;
      }
      await this.plugin.saveSettings();
      this.display();
    });
  }

  // ----------------------------------------------------------- GENERATORS

  private renderGeneratorsSection(): void {
    const { containerEl } = this;

    new Setting(containerEl).setName("Generators").setHeading();

    new Setting(containerEl)
      .setName("Prompt language")
      .setDesc(
        "Language used for the built-in generator prompts. Switch updates all presets to their localized defaults; custom edits are preserved per language.",
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
      .setDesc(
        "Deterministic guardrail. Tells the model the expected output format.",
      );
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
      .setDesc(
        "Per-note instruction. Variables: {{NOTE_BODY}}, {{NOTE_TITLE}}, {{KNOWN_TOPICS}}, {{KNOWN_CONCEPTS}}. Leave empty to use the shipped default.",
      );
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
}
