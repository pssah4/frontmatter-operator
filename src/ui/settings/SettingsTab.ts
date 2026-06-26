import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import type FrontmatterEditorPlugin from "../../main";
import {
  GENERATOR_LANGUAGE_LABELS,
  GENERATOR_LANGUAGES,
  DEFAULT_PRESETS,
} from "../../types/generators";
import { PROVIDER_LABELS } from "../../types/llm";
import { ProviderDetailModal } from "./ProviderDetailModal";

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

    this.renderProvidersSection();
    this.renderGeneratorsSection();
  }

  // --------------------------------------------------------------- PROVIDERS

  private renderProvidersSection(): void {
    const { containerEl } = this;

    new Setting(containerEl).setName("LLM providers").setHeading();

    containerEl.createDiv({
      cls: "fm-editor-modal-hint",
      text: "Add at least one provider to enable the AI generators. Anthropic, OpenAI, OpenRouter and Custom (OpenAI-compatible, incl. Ollama / LM Studio) are supported in this build. Bedrock / GitHub Copilot / ChatGPT-OAuth / Kilo Gateway are planned follow-ups.",
    });

    if (this.plugin.settings.providers.length === 0) {
      const empty = containerEl.createDiv({
        cls: "fm-editor-condition-empty",
        text: "No providers configured.",
      });
      empty.style.margin = "var(--size-4-2) 0";
    }

    for (const provider of this.plugin.settings.providers) {
      const row = new Setting(containerEl)
        .setName(provider.displayName)
        .setDesc(
          `${PROVIDER_LABELS[provider.type]} · ${provider.defaultModel ?? "no model"} · ${provider.enabled ? "enabled" : "disabled"}${this.plugin.settings.defaultProviderId === provider.id ? " · default" : ""}`,
        );

      row.addButton((b) => {
        b.setButtonText("Edit").onClick(() => {
          new ProviderDetailModal(
            this.app,
            this.plugin,
            provider,
            () => this.display(),
          ).open();
        });
      });

      row.addButton((b) => {
        b.setButtonText(
          this.plugin.settings.defaultProviderId === provider.id
            ? "Default"
            : "Make default",
        ).onClick(async () => {
          this.plugin.settings.defaultProviderId = provider.id;
          await this.plugin.saveSettings();
          this.display();
        });
      });

      row.addButton((b) => {
        b.setIcon("trash-2")
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.providers =
              this.plugin.settings.providers.filter((p) => p.id !== provider.id);
            if (this.plugin.settings.defaultProviderId === provider.id) {
              this.plugin.settings.defaultProviderId =
                this.plugin.settings.providers[0]?.id ?? null;
            }
            await this.plugin.saveSettings();
            this.display();
          });
      });
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

  // -------------------------------------------------------------- GENERATORS

  private renderGeneratorsSection(): void {
    const { containerEl } = this;

    new Setting(containerEl).setName("Generators").setHeading();

    new Setting(containerEl)
      .setName("Prompt language")
      .setDesc(
        "Language used for the built-in generator prompts. Switch to update all three presets to their localized defaults; custom edits are preserved.",
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
      const head = new Setting(containerEl)
        .setName(preset.displayName)
        .setDesc(
          `${preset.description}  ·  writes to \`${preset.targetProperty}\``,
        );
      head.addButton((b) => {
        b.setButtonText("Reset to default")
          .setWarning()
          .onClick(async () => {
            const fresh = DEFAULT_PRESETS.find((p) => p.id === preset.id);
            if (!fresh) return;
            const idx = this.plugin.settings.presets.findIndex(
              (p) => p.id === preset.id,
            );
            if (idx >= 0) {
              this.plugin.settings.presets[idx] = JSON.parse(
                JSON.stringify(fresh),
              );
              await this.plugin.saveSettings();
              this.display();
              new Notice(`Reset prompt for ${preset.displayName}`);
            }
          });
      });

      const lang = this.plugin.settings.generatorLanguage;

      const sysSetting = new Setting(containerEl)
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

      const userSetting = new Setting(containerEl)
        .setName("User prompt")
        .setDesc(
          "Per-note instruction. Variables: {{NOTE_BODY}}, {{NOTE_TITLE}}, {{KNOWN_TOPICS}}, {{KNOWN_CONCEPTS}}.",
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
}
