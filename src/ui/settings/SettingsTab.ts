import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import type FrontmatterEditorPlugin from "../../main";
import {
  GENERATOR_LANGUAGE_LABELS,
  GENERATOR_LANGUAGES,
  DEFAULT_PRESETS,
  emptyCustomPrompt,
  type GeneratorLanguage,
  type GeneratorParserId,
  type GeneratorPreset,
  type CustomPromptTemplate,
} from "../../types/generators";
import { PROVIDER_LABELS, type ProviderConfig } from "../../types/llm";
import { ProviderDetailModal } from "./ProviderDetailModal";
import { confirmModal } from "../modals/ConfirmModal";
import { promptModal } from "../modals/PromptModal";
import { renderCallout } from "../callout";
import { PromptEditorModal } from "../modals/PromptEditorModal";

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

/** Guard an unknown JSON field down to a string; non-strings use the fallback. */
function stringField(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
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
    this.renderPromptsSection();
    this.renderMaintenanceSection();
  }

  /** Vault-Operator-style section heading: uppercase, muted, hairline underline
   *  -- so the panel reads as part of the same tool family. */
  private renderSectionHeading(title: string): void {
    this.containerEl.createDiv({
      cls: "fm-editor-settings-section",
      text: title,
    });
  }

  private renderMaintenanceSection(): void {
    const { containerEl } = this;
    this.renderSectionHeading("Maintenance");
    new Setting(containerEl)
      .setName("Clean refusal text from tags")
      .setDesc(
        "Scan every note in the vault and remove sentence-shaped or known-refusal items from the `tags` property (e.g. legacy leakage like \"Based on the note content provided\"). Snapshot is saved so the cleanup is undoable.",
      )
      .addButton((b) => {
        b.setButtonText("Run cleanup").onClick(async () => {
          await this.plugin.runRefusalCleanup();
        });
      });
    new Setting(containerEl)
      .setName("Deduplicate wikilinks")
      .setDesc(
        "Scan every note and collapse frontmatter wikilinks that point at the same file (e.g. `[[Folder/Name]]` plus `[[Name]]`) to one canonical link, also shortening lone path-form links. Snapshot is saved so the change is undoable.",
      )
      .addButton((b) => {
        b.setButtonText("Run dedupe").onClick(async () => {
          await this.plugin.runWikilinkDedup();
        });
      });
  }

  private renderProvidersSection(): void {
    const { containerEl } = this;

    this.renderSectionHeading("LLM providers");

    renderCallout(
      containerEl,
      "One provider account per row. The AI chat (Generate with AI from a column header) picks the provider and concrete model at run time. 12 provider types are supported.",
    );

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
        text: "No providers configured yet. Click Add provider below.",
      });
    } else {
      for (const p of providers) this.renderProviderRow(table, p);
    }

    const footer = containerEl.createDiv({ cls: "model-table-footer" });
    const addBtn = footer.createEl("button", {
      cls: "mod-cta model-add-btn",
      text: "Add provider",
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

    // ---- Enable toggle (slim custom switch) ----
    // The checkbox uses appearance:none and sits invisibly over the whole
    // switch, so the browser's native checkbox can never show through beside
    // the track (the earlier "two overlapping toggles" bug).
    const enableEl = row.createDiv("mc-enable");
    const toggle = enableEl.createEl("label", { cls: "fm-toggle" });
    const toggleInput = toggle.createEl("input", {
      attr: { type: "checkbox" },
    });
    toggleInput.checked = provider.enabled;
    toggle.createSpan({ cls: "fm-toggle-track" });
    toggleInput.addEventListener("change", () => {
      void (async () => {
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
      })();
    });

    // ---- Default radio (single-pick across all rows) ----
    const defaultEl = row.createDiv("mc-default");
    const defaultRadio = defaultEl.createEl("input", {
      attr: { type: "radio", name: "active-provider" },
    });
    defaultRadio.checked = isActive;
    defaultRadio.disabled = !provider.enabled;
    defaultRadio.addEventListener("change", () => {
      void (async () => {
        if (defaultRadio.checked) {
          this.plugin.settings.defaultProviderId = provider.id;
          await this.plugin.saveSettings();
          this.display();
        }
      })();
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
    delBtn.addEventListener("click", () => {
      void (async () => {
        const ok = await confirmModal(this.app, {
          title: "Remove provider?",
          message: `Remove provider "${provider.displayName || PROVIDER_LABELS[provider.type]}"? This clears its configuration.`,
          confirmLabel: "Remove",
          cancelLabel: "Cancel",
          destructive: true,
        });
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
      })();
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

  /**
   * One unified prompt list (built-in + custom look identical -- "a prompt is a
   * prompt"). Each row opens the same editor; built-in prompts can be deleted
   * and re-seeded via "Restore built-in prompts".
   */
  private renderPromptsSection(): void {
    const { containerEl } = this;

    this.renderSectionHeading("Prompts");

    renderCallout(
      containerEl,
      "Prompts fill one frontmatter property with AI output, one note at a time. Run a prompt from a note table: open a property column's chevron menu and choose Generate with AI. A safety guardrail is always added automatically.",
    );

    new Setting(containerEl)
      .setName("Prompt language")
      .setDesc("Language for the built-in prompt text. Edits are kept per language.")
      .addDropdown((d) => {
        for (const l of GENERATOR_LANGUAGES) {
          d.addOption(l, GENERATOR_LANGUAGE_LABELS[l]);
        }
        d.setValue(this.plugin.settings.generatorLanguage);
        d.onChange(async (value) => {
          this.plugin.settings.generatorLanguage = value as GeneratorLanguage;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    // Create row.
    const createWrap = containerEl.createDiv({ cls: "fm-editor-prompt-create" });
    const nameInput = createWrap.createEl("input", {
      type: "text",
      cls: "fm-editor-filter-input",
      placeholder: 'New prompt name (e.g. "Short summary")',
    });
    const createBtn = createWrap.createEl("button", {
      cls: "fm-editor-btn fm-editor-btn-primary",
      text: "Create prompt",
    });
    const doCreate = (): void => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      new PromptEditorModal(this.app, {
        title: "New prompt",
        draft: { name, targetProperty: "", parser: "single_line_text", text: "" },
        onSave: async (draft) => {
          const tpl = emptyCustomPrompt(draft.targetProperty);
          tpl.name = draft.name;
          tpl.parser = draft.parser;
          tpl.prompt = draft.text;
          this.plugin.settings.customPrompts.push(tpl);
          await this.plugin.saveSettings();
          this.display();
        },
      }).open();
    };
    createBtn.addEventListener("click", doCreate);
    nameInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        doCreate();
      }
    });

    const importBtn = createWrap.createEl("button", {
      cls: "fm-editor-btn",
      text: "Import",
    });
    importBtn.addEventListener("click", () => void this.importPrompt());

    // Unified list.
    const list = containerEl.createDiv({ cls: "fm-editor-prompt-list" });
    const total =
      this.plugin.settings.presets.length +
      this.plugin.settings.customPrompts.length;
    if (total === 0) {
      list.createDiv({
        cls: "fm-editor-prompt-empty",
        text: "No prompts yet. Create one above.",
      });
    }
    const lang = this.plugin.settings.generatorLanguage;
    for (const preset of this.plugin.settings.presets) {
      this.renderPromptRow(list, {
        name: preset.displayName,
        target: preset.targetProperty,
        description: preset.description,
        enabled: preset.enabled !== false,
        onEdit: () => this.editPreset(preset),
        onExport: () => {
          void this.exportPrompt(
            preset.displayName,
            preset.targetProperty,
            preset.parser,
            preset.prompts[lang],
          );
        },
        onDelete: () => this.deletePreset(preset),
        onToggle: async (enabled) => {
          preset.enabled = enabled;
          await this.plugin.saveSettings();
        },
      });
    }
    for (const tpl of this.plugin.settings.customPrompts) {
      this.renderPromptRow(list, {
        name: tpl.name,
        target: tpl.targetProperty,
        enabled: tpl.enabled !== false,
        onEdit: () => this.editCustom(tpl),
        onExport: () => {
          void this.exportPrompt(tpl.name, tpl.targetProperty, tpl.parser, tpl.prompt);
        },
        onDelete: () => this.deleteCustom(tpl),
        onToggle: async (enabled) => {
          tpl.enabled = enabled;
          await this.plugin.saveSettings();
        },
      });
    }

    // Offer to re-seed any deleted built-in prompts.
    const missing = DEFAULT_PRESETS.filter(
      (dp) => !this.plugin.settings.presets.some((p) => p.id === dp.id),
    );
    if (missing.length > 0) {
      const restore = containerEl.createEl("button", {
        cls: "fm-editor-btn fm-editor-prompt-restore",
        text: `Restore ${missing.length} built-in prompt${missing.length === 1 ? "" : "s"}`,
      });
      restore.addEventListener("click", () => {
        void (async () => {
          for (const dp of missing) {
            this.plugin.settings.presets.push(
              JSON.parse(JSON.stringify(dp)) as GeneratorPreset,
            );
          }
          await this.plugin.saveSettings();
          this.display();
        })();
      });
    }
  }

  private renderPromptRow(
    list: HTMLElement,
    item: {
      name: string;
      target: string;
      description?: string;
      enabled: boolean;
      onEdit: () => void;
      onExport: () => void;
      onDelete: () => Promise<void>;
      onToggle: (enabled: boolean) => Promise<void>;
    },
  ): void {
    const row = list.createDiv({ cls: "fm-editor-prompt-row" });
    if (!item.enabled) row.addClass("is-disabled");
    const nameEl = row.createSpan({
      cls: "fm-editor-prompt-name",
      text: item.name,
    });
    if (item.description) nameEl.title = item.description;
    if (item.target) {
      row.createSpan({ cls: "fm-editor-prompt-target", text: item.target });
    }

    // Actions mirror Vault Operator's row: edit, export, delete, enable-toggle.
    const actions = row.createDiv({ cls: "fm-editor-prompt-actions" });

    const edit = actions.createEl("button", { cls: "fm-editor-icon-btn" });
    setIcon(edit, "pencil");
    edit.title = "Edit prompt";
    edit.addEventListener("click", item.onEdit);

    const exportBtn = actions.createEl("button", { cls: "fm-editor-icon-btn" });
    setIcon(exportBtn, "download");
    exportBtn.title = "Copy prompt as JSON";
    exportBtn.addEventListener("click", item.onExport);

    const del = actions.createEl("button", {
      cls: "fm-editor-icon-btn mod-warning",
    });
    setIcon(del, "trash-2");
    del.title = "Delete prompt";
    del.addEventListener("click", () => void item.onDelete());

    const toggle = actions.createEl("label", { cls: "fm-toggle" });
    const cb = toggle.createEl("input", { attr: { type: "checkbox" } });
    cb.checked = item.enabled;
    toggle.createSpan({ cls: "fm-toggle-track" });
    toggle.title = item.enabled ? "Enabled" : "Disabled";
    cb.addEventListener("change", () => {
      row.toggleClass("is-disabled", !cb.checked);
      toggle.title = cb.checked ? "Enabled" : "Disabled";
      void item.onToggle(cb.checked);
    });
  }

  private async exportPrompt(
    name: string,
    targetProperty: string,
    parser: GeneratorParserId,
    text: string,
  ): Promise<void> {
    const json = JSON.stringify({ name, targetProperty, parser, prompt: text });
    try {
      await navigator.clipboard.writeText(json);
      new Notice(`Copied "${name}" to clipboard as JSON.`);
    } catch {
      new Notice("Could not access the clipboard.");
    }
  }

  private async importPrompt(): Promise<void> {
    const json = await promptModal(this.app, {
      title: "Import prompt",
      message: "Paste a prompt JSON (name, targetProperty, parser, prompt).",
      placeholder: '{"name":"...","targetProperty":"...","parser":"single_line_text","prompt":"..."}',
      confirmLabel: "Import",
    });
    if (!json) return;
    try {
      const obj = JSON.parse(json) as Record<string, unknown>;
      const target = stringField(obj.targetProperty);
      const tpl = emptyCustomPrompt(target);
      tpl.name = stringField(obj.name, "Imported prompt");
      tpl.targetProperty = target;
      const parser = stringField(obj.parser);
      tpl.parser = (
        ["single_line_text", "list_string", "moc_topics_concepts"].includes(parser)
          ? parser
          : "single_line_text"
      ) as GeneratorParserId;
      tpl.prompt = stringField(obj.prompt);
      this.plugin.settings.customPrompts.push(tpl);
      await this.plugin.saveSettings();
      this.display();
      new Notice(`Imported "${tpl.name}".`);
    } catch {
      new Notice("Invalid prompt JSON.");
    }
  }

  private editPreset(preset: GeneratorPreset): void {
    const lang = this.plugin.settings.generatorLanguage;
    new PromptEditorModal(this.app, {
      title: "Edit prompt",
      languageNote: `${GENERATOR_LANGUAGE_LABELS[lang]} text`,
      draft: {
        name: preset.displayName,
        targetProperty: preset.targetProperty,
        parser: preset.parser,
        text: preset.prompts[lang],
      },
      onReset: preset.isBuiltIn
        ? async () => {
            const fresh = DEFAULT_PRESETS.find((p) => p.id === preset.id);
            if (!fresh) return;
            const idx = this.plugin.settings.presets.findIndex(
              (p) => p.id === preset.id,
            );
            if (idx >= 0) {
              this.plugin.settings.presets[idx] = JSON.parse(
                JSON.stringify(fresh),
              ) as GeneratorPreset;
              await this.plugin.saveSettings();
              this.display();
              new Notice(`Reset "${fresh.displayName}"`);
            }
          }
        : undefined,
      onSave: async (draft) => {
        preset.displayName = draft.name;
        preset.targetProperty = draft.targetProperty;
        preset.parser = draft.parser;
        preset.prompts[lang] = draft.text;
        await this.plugin.saveSettings();
        this.display();
      },
    }).open();
  }

  private editCustom(tpl: CustomPromptTemplate): void {
    new PromptEditorModal(this.app, {
      title: "Edit prompt",
      draft: {
        name: tpl.name,
        targetProperty: tpl.targetProperty,
        parser: tpl.parser,
        text: tpl.prompt,
      },
      onSave: async (draft) => {
        tpl.name = draft.name;
        tpl.targetProperty = draft.targetProperty;
        tpl.parser = draft.parser;
        tpl.prompt = draft.text;
        await this.plugin.saveSettings();
        this.display();
      },
    }).open();
  }

  private async deletePreset(preset: GeneratorPreset): Promise<void> {
    const ok = await confirmModal(this.app, {
      title: "Delete prompt?",
      message: `Remove "${preset.displayName}"? You can restore built-in prompts afterwards.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    this.plugin.settings.presets = this.plugin.settings.presets.filter(
      (p) => p.id !== preset.id,
    );
    await this.plugin.saveSettings();
    this.display();
  }

  private async deleteCustom(tpl: CustomPromptTemplate): Promise<void> {
    const ok = await confirmModal(this.app, {
      title: "Delete prompt?",
      message: `Remove "${tpl.name}"?`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    this.plugin.settings.customPrompts =
      this.plugin.settings.customPrompts.filter((p) => p.id !== tpl.id);
    await this.plugin.saveSettings();
    this.display();
  }
}
