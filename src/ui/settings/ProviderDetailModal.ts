import { App, Modal, Notice, Setting } from "obsidian";
import type FrontmatterEditorPlugin from "../../main";
import type { ProviderConfig, ProviderType } from "../../types/llm";
import {
  MODEL_SUGGESTIONS,
  PROVIDER_DEFAULT_BASE_URLS,
  PROVIDER_LABELS,
} from "../../types/llm";
import { buildApiHandler } from "../../api/ProviderRegistry";

export class ProviderDetailModal extends Modal {
  private form: ProviderConfig;
  private isNew: boolean;
  private testEl: HTMLElement | null = null;

  constructor(
    app: App,
    private plugin: FrontmatterEditorPlugin,
    initial: ProviderConfig | null,
    private onSaved: () => void,
  ) {
    super(app);
    this.isNew = !initial;
    this.form = initial
      ? { ...initial }
      : {
          id: crypto.randomUUID
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2, 10),
          type: "anthropic",
          displayName: "Anthropic",
          enabled: true,
          apiKey: "",
          baseUrl: PROVIDER_DEFAULT_BASE_URLS.anthropic,
          defaultModel: MODEL_SUGGESTIONS.anthropic[0],
        };
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal-content");
    titleEl.setText(this.isNew ? "Add provider" : "Edit provider");

    new Setting(contentEl)
      .setName("Provider type")
      .setDesc("Which API does this provider use?")
      .addDropdown((d) => {
        for (const type of Object.keys(PROVIDER_LABELS) as ProviderType[]) {
          d.addOption(type, PROVIDER_LABELS[type]);
        }
        d.setValue(this.form.type);
        d.onChange((value) => {
          this.form.type = value as ProviderType;
          this.form.baseUrl = PROVIDER_DEFAULT_BASE_URLS[this.form.type];
          this.form.defaultModel =
            MODEL_SUGGESTIONS[this.form.type][0] ?? this.form.defaultModel;
          if (this.isNew) {
            this.form.displayName = PROVIDER_LABELS[this.form.type];
          }
          this.onOpen();
        });
      });

    new Setting(contentEl)
      .setName("Display name")
      .setDesc("Friendly label shown in dropdowns.")
      .addText((t) => {
        t.setValue(this.form.displayName).onChange((v) => {
          this.form.displayName = v;
        });
      });

    new Setting(contentEl)
      .setName("API key")
      .setDesc(
        this.form.type === "custom"
          ? "Optional. Required for OpenRouter-compatible endpoints that need a token."
          : "Required. Stored in the plugin's data.json -- treat the vault folder accordingly.",
      )
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("sk-... or sk-or-...")
          .setValue(this.form.apiKey ?? "")
          .onChange((v) => {
            this.form.apiKey = v;
          });
      });

    new Setting(contentEl)
      .setName("Base URL")
      .setDesc("Override the default endpoint (e.g. Ollama on a different port).")
      .addText((t) => {
        t.setPlaceholder(PROVIDER_DEFAULT_BASE_URLS[this.form.type])
          .setValue(this.form.baseUrl ?? "")
          .onChange((v) => {
            this.form.baseUrl = v;
          });
      });

    new Setting(contentEl)
      .setName("Default model")
      .setDesc("Model id used by generators when this provider is selected.")
      .addText((t) => {
        t.setPlaceholder(MODEL_SUGGESTIONS[this.form.type][0] ?? "")
          .setValue(this.form.defaultModel ?? "")
          .onChange((v) => {
            this.form.defaultModel = v;
          });
      })
      .then((s) => {
        const suggestions = MODEL_SUGGESTIONS[this.form.type] ?? [];
        if (suggestions.length === 0) return;
        const list = s.controlEl.createDiv({
          cls: "fm-editor-modal-chips-list",
        });
        for (const id of suggestions) {
          const pill = list.createEl("button", {
            cls: "fm-editor-pill",
            text: id,
          });
          pill.addEventListener("click", (ev) => {
            ev.preventDefault();
            this.form.defaultModel = id;
            this.onOpen();
          });
        }
      });

    new Setting(contentEl)
      .setName("Enabled")
      .setDesc("Disabled providers stay in the list but are hidden from generators.")
      .addToggle((t) => {
        t.setValue(this.form.enabled).onChange((v) => {
          this.form.enabled = v;
        });
      });

    const testRow = contentEl.createDiv({ cls: "fm-editor-modal-row" });
    const testBtn = testRow.createEl("button", {
      text: "Test connection",
      cls: "fm-editor-btn",
    });
    this.testEl = testRow.createDiv({ cls: "fm-editor-modal-status" });
    testBtn.addEventListener("click", async () => {
      if (!this.testEl) return;
      this.testEl.setText("Pinging...");
      try {
        const handler = buildApiHandler(this.form);
        const result = await handler.ping();
        if (result.ok) {
          this.testEl.setText(`OK — model returned: ${result.model}`);
        } else {
          this.testEl.setText(`Failed — ${result.error}`);
        }
      } catch (err) {
        this.testEl.setText(
          `Failed — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    const footer = contentEl.createDiv({ cls: "fm-editor-modal-footer" });
    const right = footer.createDiv({ cls: "fm-editor-modal-footer-right" });
    const cancel = right.createEl("button", {
      text: "Cancel",
      cls: "fm-editor-btn",
    });
    cancel.addEventListener("click", () => this.close());
    const save = right.createEl("button", {
      text: this.isNew ? "Add provider" : "Save",
      cls: "fm-editor-btn mod-cta",
    });
    save.addEventListener("click", async () => {
      if (!this.form.displayName.trim()) {
        new Notice("Display name is required");
        return;
      }
      const list = this.plugin.settings.providers.filter(
        (p) => p.id !== this.form.id,
      );
      list.push({ ...this.form });
      this.plugin.settings.providers = list;
      if (!this.plugin.settings.defaultProviderId) {
        this.plugin.settings.defaultProviderId = this.form.id;
      }
      await this.plugin.saveSettings();
      this.onSaved();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
