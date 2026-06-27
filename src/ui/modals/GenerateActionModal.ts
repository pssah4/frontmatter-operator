import { App, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import type FrontmatterEditorPlugin from "../../main";
import type { NoteRow } from "../../types";
import type {
  CustomPromptTemplate,
  GeneratorParserId,
  GeneratorPreset,
} from "../../types/generators";
import { emptyCustomPrompt } from "../../types/generators";
import {
  MODEL_SUGGESTIONS,
  PROVIDER_LABELS,
  type ProviderConfig,
  type RunModelOptions,
  getMaxTemperature,
  isTemperatureFixed,
  recommendedMaxTokens,
  supportsThinking,
} from "../../types/llm";

type NoteScope = "matched" | "selected" | "active-note";

export interface GenerateModalOptions {
  targetProperty: string;
  matchedRows: NoteRow[];
  tickedRows: NoteRow[];
  activeFile?: TFile | null;
  initialScope?: NoteScope;
}

/**
 * AI chat / generator modal. Picks provider + model + decode parameters per
 * run, plus the prompt (built-in / custom / live edit) and the notes scope.
 *
 * Everything that's per-run lives here. Provider _accounts_ (auth) live in
 * settings.providers[]; the AI chat picks one of them and a concrete model
 * from its discovery cache.
 */
export class GenerateActionModal extends Modal {
  private opts: GenerateModalOptions;
  private selectedPromptId: string;
  private liveSystemPrompt: string;
  private liveUserPrompt: string;
  private liveParser: GeneratorParserId = "single_line_text";
  private selectedProviderId: string | null = null;
  private selectedModelId = "";
  private decode: RunModelOptions = { modelId: "" };
  private noteScope: NoteScope;
  private skipIfPropertyExists = false;
  private statusEl: HTMLElement | null = null;
  private runBtn: HTMLButtonElement | null = null;
  private showAdvanced = false;
  private onDone: () => void;

  constructor(
    app: App,
    private plugin: FrontmatterEditorPlugin,
    opts: GenerateModalOptions,
    onDone: () => void,
  ) {
    super(app);
    this.opts = opts;
    this.onDone = onDone;

    if (opts.initialScope) this.noteScope = opts.initialScope;
    else if (opts.tickedRows.length > 0) this.noteScope = "selected";
    else if (opts.matchedRows.length > 0) this.noteScope = "matched";
    else this.noteScope = "active-note";

    const builtIn = plugin.settings.presets.find(
      (p) => p.targetProperty === opts.targetProperty,
    );
    const custom = plugin.settings.customPrompts.find(
      (p) => p.targetProperty === opts.targetProperty,
    );
    if (builtIn) {
      this.selectedPromptId = `built:${builtIn.id}`;
      const lang = plugin.settings.generatorLanguage;
      this.liveSystemPrompt = builtIn.prompts[lang].systemPrompt;
      this.liveUserPrompt = builtIn.prompts[lang].userPrompt;
      this.liveParser = builtIn.parser;
    } else if (custom) {
      this.selectedPromptId = `custom:${custom.id}`;
      this.liveSystemPrompt = custom.systemPrompt;
      this.liveUserPrompt = custom.userPrompt;
      this.liveParser = custom.parser;
    } else {
      this.selectedPromptId = "live";
      this.liveSystemPrompt = defaultSystemPrompt();
      this.liveUserPrompt = defaultUserPrompt(opts.targetProperty);
    }

    // Pick default provider + model.
    const enabledProviders = plugin.settings.providers.filter((p) => p.enabled);
    this.selectedProviderId =
      plugin.settings.defaultProviderId &&
      enabledProviders.some((p) => p.id === plugin.settings.defaultProviderId)
        ? plugin.settings.defaultProviderId
        : (enabledProviders[0]?.id ?? null);
    this.initModelForProvider();
  }

  private getSelectedProvider(): ProviderConfig | null {
    return (
      this.plugin.settings.providers.find((p) => p.id === this.selectedProviderId) ??
      null
    );
  }

  /** When the selected provider changes, pick a model from the cached list
   *  or fall back to the last used / static suggestion / blank. */
  private initModelForProvider(): void {
    const provider = this.getSelectedProvider();
    if (!provider) {
      this.selectedModelId = "";
      return;
    }
    const last = this.plugin.settings.lastUsedModelByProvider[provider.id];
    const cached = provider.discoveredModels ?? [];
    const candidates = cached.length > 0
      ? cached.map((m) => m.id)
      : (MODEL_SUGGESTIONS[provider.type] ?? []).map((s) => s.id);
    const fallback = last ?? candidates[0] ?? "";
    this.selectedModelId = fallback;
    this.decode = { modelId: fallback };
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal-content");
    titleEl.setText(`Generate with AI -> ${this.opts.targetProperty}`);

    const enabledProviders = this.plugin.settings.providers.filter((p) => p.enabled);
    if (enabledProviders.length === 0) {
      this.renderEmptyState(contentEl);
      return;
    }

    const targets = this.computeTargets();
    const banner = contentEl.createDiv({ cls: "fm-editor-modal-target" });
    banner.createSpan({ cls: "fm-editor-modal-target-label", text: "Target" });
    banner.createSpan({
      cls: "fm-editor-modal-target-count",
      text: `${targets.length} ${targets.length === 1 ? "note" : "notes"} -> \`${this.opts.targetProperty}\``,
    });

    // Prompt
    new Setting(contentEl)
      .setName("Prompt")
      .setDesc("Pick a built-in preset, a saved custom prompt, or live-edit below.")
      .addDropdown((d) => {
        const builtIns = this.plugin.settings.presets.filter(
          (p) => p.targetProperty === this.opts.targetProperty,
        );
        const customs = this.plugin.settings.customPrompts.filter(
          (p) => p.targetProperty === this.opts.targetProperty,
        );
        for (const p of builtIns) d.addOption(`built:${p.id}`, `Default: ${p.displayName}`);
        for (const p of customs) d.addOption(`custom:${p.id}`, `Custom: ${p.name}`);
        d.addOption("live", "Live edit (not saved)");
        d.setValue(this.selectedPromptId);
        d.onChange((v) => {
          this.selectedPromptId = v;
          this.applyPromptChoice();
          this.onOpen();
        });
      });

    const sysSetting = new Setting(contentEl)
      .setName("System prompt")
      .setDesc("Guardrail. Tells the model the expected output format.");
    sysSetting.controlEl.style.display = "block";
    sysSetting.controlEl.style.width = "100%";
    const sysTa = sysSetting.controlEl.createEl("textarea", {
      cls: "fm-editor-generator-textarea",
      text: this.liveSystemPrompt,
    });
    sysTa.rows = 5;
    sysTa.addEventListener("input", () => {
      this.liveSystemPrompt = sysTa.value;
    });

    const userSetting = new Setting(contentEl)
      .setName("User prompt")
      .setDesc("Variables: {{NOTE_BODY}}, {{NOTE_TITLE}}, {{KNOWN_TOPICS}}, {{KNOWN_CONCEPTS}}.");
    userSetting.controlEl.style.display = "block";
    userSetting.controlEl.style.width = "100%";
    const userTa = userSetting.controlEl.createEl("textarea", {
      cls: "fm-editor-generator-textarea",
      text: this.liveUserPrompt,
    });
    userTa.rows = 9;
    userTa.addEventListener("input", () => {
      this.liveUserPrompt = userTa.value;
    });

    new Setting(contentEl)
      .setName("Output format")
      .setDesc("Deterministic parser used on the response.")
      .addDropdown((d) => {
        d.addOption("single_line_text", "Single-line text");
        d.addOption("list_string", "List of strings");
        d.addOption("moc_topics_concepts", "MoC: topics + concepts");
        d.setValue(this.liveParser);
        d.onChange((v) => {
          this.liveParser = v as GeneratorParserId;
        });
      });

    new Setting(contentEl)
      .setName("Save as custom prompt")
      .setDesc(`Save the current prompt for \`${this.opts.targetProperty}\`.`)
      .addButton((b) => {
        b.setButtonText("Save").onClick(async () => {
          const name = window.prompt(
            "Name this custom prompt",
            `Custom for ${this.opts.targetProperty}`,
          );
          if (!name) return;
          const tpl: CustomPromptTemplate = emptyCustomPrompt(
            this.opts.targetProperty,
          );
          tpl.name = name;
          tpl.systemPrompt = this.liveSystemPrompt;
          tpl.userPrompt = this.liveUserPrompt;
          tpl.parser = this.liveParser;
          this.plugin.settings.customPrompts.push(tpl);
          await this.plugin.saveSettings();
          this.selectedPromptId = `custom:${tpl.id}`;
          new Notice(`Saved "${name}".`);
          this.onOpen();
        });
      });

    // Provider + Model
    new Setting(contentEl)
      .setName("Provider")
      .addDropdown((d) => {
        for (const p of enabledProviders) {
          d.addOption(p.id, `${p.displayName}  ·  ${PROVIDER_LABELS[p.type]}`);
        }
        if (this.selectedProviderId) d.setValue(this.selectedProviderId);
        d.onChange((v) => {
          this.selectedProviderId = v;
          this.initModelForProvider();
          this.onOpen();
        });
      });

    this.renderModelRow(contentEl);

    // Notes scope
    new Setting(contentEl)
      .setName("Notes scope")
      .addDropdown((d) => {
        const active = this.opts.activeFile ?? this.app.workspace.getActiveFile();
        if (active) d.addOption("active-note", `Active note (${active.basename})`);
        d.addOption("matched", `Matched notes (${this.opts.matchedRows.length})`);
        if (this.opts.tickedRows.length > 0) {
          d.addOption("selected", `Selected only (${this.opts.tickedRows.length})`);
        }
        d.setValue(this.noteScope);
        d.onChange((v) => {
          this.noteScope = v as NoteScope;
          this.onOpen();
        });
      });

    new Setting(contentEl)
      .setName("Skip notes that already have the target property")
      .addToggle((t) => {
        t.setValue(this.skipIfPropertyExists).onChange((v) => {
          this.skipIfPropertyExists = v;
        });
      });

    // Advanced toggle
    new Setting(contentEl)
      .setName("Advanced decode parameters")
      .setDesc("Override max tokens, temperature, thinking budget for this run.")
      .addToggle((t) => {
        t.setValue(this.showAdvanced).onChange((v) => {
          this.showAdvanced = v;
          this.onOpen();
        });
      });
    if (this.showAdvanced) this.renderAdvancedRows(contentEl);

    this.statusEl = contentEl.createDiv({ cls: "fm-editor-modal-status" });

    const footer = contentEl.createDiv({ cls: "fm-editor-modal-footer" });
    const right = footer.createDiv({ cls: "fm-editor-modal-footer-right" });
    const cancel = right.createEl("button", { cls: "fm-editor-btn", text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const run = right.createEl("button", { cls: "fm-editor-btn mod-cta" });
    setIcon(run.createSpan(), "sparkles");
    run.createSpan({ text: "Generate" });
    run.addEventListener("click", () => this.runGeneration());
    this.runBtn = run;
  }

  private renderModelRow(parent: HTMLElement): void {
    const provider = this.getSelectedProvider();
    if (!provider) return;
    const cached = provider.discoveredModels ?? [];
    const staticSuggestions = MODEL_SUGGESTIONS[provider.type] ?? [];
    const setting = new Setting(parent)
      .setName("Model")
      .setDesc(
        cached.length > 0
          ? `${cached.length} models cached. Edit provider in Settings to refresh.`
          : "No cached models. Either refresh discovery in provider settings, pick from the suggestions list, or type a model id manually.",
      );
    const select = setting.controlEl.createEl("select");
    select.createEl("option", { value: "", text: "(custom)" });
    const items =
      cached.length > 0
        ? cached.map((c) => ({ id: c.id, label: c.label, group: c.group ?? "Available" }))
        : staticSuggestions;
    const groups = new Map<string, typeof items>();
    for (const it of items) {
      const list = groups.get(it.group ?? "Available") ?? [];
      list.push(it);
      groups.set(it.group ?? "Available", list);
    }
    for (const [g, list] of groups) {
      const og = select.createEl("optgroup");
      og.label = g;
      for (const it of list) {
        const opt = og.createEl("option", { value: it.id, text: it.label });
        if (it.id === this.selectedModelId) opt.selected = true;
      }
    }
    select.addEventListener("change", () => {
      if (select.value) {
        this.selectedModelId = select.value;
        this.decode = { ...this.decode, modelId: select.value };
      }
    });
    setting.addText((t) => {
      t.setPlaceholder("or paste a model id")
        .setValue(this.selectedModelId)
        .onChange((v) => {
          this.selectedModelId = v;
          this.decode = { ...this.decode, modelId: v };
        });
    });
  }

  private renderAdvancedRows(parent: HTMLElement): void {
    const provider = this.getSelectedProvider();
    if (!provider) return;
    const modelId = this.decode.modelId || this.selectedModelId;

    new Setting(parent)
      .setName("Max output tokens")
      .setDesc(`Default: auto (~${recommendedMaxTokens(modelId)} based on model).`)
      .addText((t) => {
        t.setPlaceholder("auto")
          .setValue(this.decode.maxTokens?.toString() ?? "")
          .onChange((v) => {
            const n = parseInt(v, 10);
            this.decode.maxTokens = Number.isFinite(n) ? n : undefined;
          });
      });

    if (!isTemperatureFixed(provider.type, modelId)) {
      new Setting(parent)
        .setName(`Temperature (0 - ${getMaxTemperature(provider.type)})`)
        .setDesc("Empty = model default (0).")
        .addText((t) => {
          t.setPlaceholder("0")
            .setValue(this.decode.temperature?.toString() ?? "")
            .onChange((v) => {
              const n = parseFloat(v);
              this.decode.temperature = Number.isFinite(n) ? n : undefined;
            });
        });
    }

    if (supportsThinking(provider.type, modelId)) {
      new Setting(parent)
        .setName("Extended thinking")
        .addToggle((t) => {
          t.setValue(!!this.decode.thinkingEnabled).onChange((v) => {
            this.decode.thinkingEnabled = v;
            if (v && this.decode.thinkingBudgetTokens === undefined) {
              this.decode.thinkingBudgetTokens = 10_000;
            }
            this.onOpen();
          });
        });
      if (this.decode.thinkingEnabled) {
        new Setting(parent)
          .setName("Thinking budget (tokens)")
          .addText((t) => {
            t.setPlaceholder("10000")
              .setValue(this.decode.thinkingBudgetTokens?.toString() ?? "10000")
              .onChange((v) => {
                const n = parseInt(v, 10);
                this.decode.thinkingBudgetTokens = Number.isFinite(n) ? n : 10_000;
              });
          });
      }
    }
  }

  private applyPromptChoice(): void {
    if (this.selectedPromptId.startsWith("built:")) {
      const id = this.selectedPromptId.slice("built:".length);
      const preset = this.plugin.settings.presets.find((p) => p.id === id);
      if (preset) {
        const lang = this.plugin.settings.generatorLanguage;
        this.liveSystemPrompt = preset.prompts[lang].systemPrompt;
        this.liveUserPrompt = preset.prompts[lang].userPrompt;
        this.liveParser = preset.parser;
      }
    } else if (this.selectedPromptId.startsWith("custom:")) {
      const id = this.selectedPromptId.slice("custom:".length);
      const tpl = this.plugin.settings.customPrompts.find((p) => p.id === id);
      if (tpl) {
        this.liveSystemPrompt = tpl.systemPrompt;
        this.liveUserPrompt = tpl.userPrompt;
        this.liveParser = tpl.parser;
      }
    }
  }

  private renderEmptyState(parent: HTMLElement): void {
    parent.createDiv({
      cls: "fm-editor-modal-hint",
      text: "No LLM provider configured. Open plugin settings to add one.",
    });
    const footer = parent.createDiv({ cls: "fm-editor-modal-footer" });
    const right = footer.createDiv({ cls: "fm-editor-modal-footer-right" });
    const close = right.createEl("button", { text: "Cancel", cls: "fm-editor-btn" });
    close.addEventListener("click", () => this.close());
    const openSettings = right.createEl("button", { cls: "fm-editor-btn mod-cta" });
    setIcon(openSettings.createSpan(), "settings");
    openSettings.createSpan({ text: "Open plugin settings" });
    openSettings.addEventListener("click", () => {
      const setting = (this.app as unknown as {
        setting?: { open: () => void; openTabById: (id: string) => void };
      }).setting;
      if (!setting) return;
      this.close();
      setting.open();
      setting.openTabById(this.plugin.manifest.id);
    });
  }

  private computeTargets(): NoteRow[] {
    if (this.noteScope === "selected") return this.opts.tickedRows;
    if (this.noteScope === "active-note") {
      const active = this.opts.activeFile ?? this.app.workspace.getActiveFile();
      if (!active) return [];
      return [
        {
          file: active,
          path: active.path,
          basename: active.basename,
          frontmatter: this.plugin.scanner.readFrontmatter(active) ?? {},
        },
      ];
    }
    return this.opts.matchedRows;
  }

  private async runGeneration(): Promise<void> {
    const provider = this.getSelectedProvider();
    if (!provider) {
      new Notice("Pick a provider");
      return;
    }
    if (!this.selectedModelId) {
      new Notice("Pick a model");
      return;
    }
    const targets = this.computeTargets();
    if (targets.length === 0) {
      new Notice("No notes in the chosen scope.");
      return;
    }
    if (this.runBtn) this.runBtn.setAttribute("disabled", "true");

    // Persist last-used model per provider.
    this.plugin.settings.lastUsedModelByProvider[provider.id] = this.selectedModelId;
    await this.plugin.saveSettings();

    const adhoc: GeneratorPreset = {
      id: "adhoc",
      displayName: "Ad-hoc",
      targetProperty: this.opts.targetProperty,
      description: "",
      parser: this.liveParser,
      isBuiltIn: false,
      prompts: {
        en: { systemPrompt: this.liveSystemPrompt, userPrompt: this.liveUserPrompt },
        de: { systemPrompt: this.liveSystemPrompt, userPrompt: this.liveUserPrompt },
      },
    };

    const files: TFile[] = targets.map((r) => r.file);
    const knownTopics: string[] = [];
    const knownConcepts: string[] = [];
    if (this.liveParser === "moc_topics_concepts") {
      const rows = this.plugin.scanner.buildAllRows();
      for (const r of rows) {
        const v = r.frontmatter[this.opts.targetProperty];
        if (v && typeof v === "object" && !Array.isArray(v)) {
          const o = v as { topics?: unknown; concepts?: unknown };
          if (Array.isArray(o.topics)) for (const t of o.topics) knownTopics.push(String(t));
          if (Array.isArray(o.concepts)) for (const c of o.concepts) knownConcepts.push(String(c));
        }
      }
    }

    this.setStatus(`0 / ${files.length} ...`);
    try {
      const result = await this.plugin.generator.run({
        preset: adhoc,
        provider,
        model: { ...this.decode, modelId: this.selectedModelId },
        language: this.plugin.settings.generatorLanguage,
        targets: files,
        skipIfPropertyExists: this.skipIfPropertyExists,
        knownTopics: dedupCi(knownTopics),
        knownConcepts: dedupCi(knownConcepts),
        onProgress: (current, total, file) => {
          this.setStatus(`${current} / ${total}  ·  ${file.basename}`);
        },
      });
      const parts = [
        `${result.successCount} generated`,
        `${result.skippedCount} skipped`,
        result.errorCount > 0 ? `${result.errorCount} errors` : null,
      ].filter(Boolean);
      new Notice(`Generator: ${parts.join(", ")}`);
      if (result.errors.length > 0) {
        console.warn("frontmatter-editor: generator errors", result.errors);
      }
      this.onDone();
      if (result.errorCount === 0) {
        this.close();
      } else {
        this.setStatus("Done with errors. Check developer console.");
        if (this.runBtn) this.runBtn.removeAttribute("disabled");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Generator failed: ${message}`);
      this.setStatus(`Failed: ${message}`);
      if (this.runBtn) this.runBtn.removeAttribute("disabled");
    }
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.setText(text);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function dedupCi(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of items) {
    const key = i.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}

function defaultSystemPrompt(): string {
  return `You write structured frontmatter content. Return ONLY the requested block in the exact format. The plugin parses your output deterministically; do not invent additional YAML or frontmatter keys.`;
}

function defaultUserPrompt(property: string): string {
  return `Generate a concise value for the "${property}" frontmatter property of the active note, based on the note content.\n\nFollow the system prompt's format strictly.\n\nNote content:\n{{NOTE_BODY}}`;
}
