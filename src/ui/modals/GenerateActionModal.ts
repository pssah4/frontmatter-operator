import { App, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import type FrontmatterEditorPlugin from "../../main";
import type { NoteRow } from "../../types";
import type { CustomModel } from "../../types/llm";
import type {
  CustomPromptTemplate,
  GeneratorParserId,
  GeneratorPreset,
} from "../../types/generators";
import { emptyCustomPrompt } from "../../types/generators";

type NoteScope = "matched" | "selected" | "active-note";

/**
 * Mini-chat / picker for ad-hoc generation against a single column
 * (frontmatter property). Lets the user pick:
 *   - which prompt to use (a built-in preset, a saved custom prompt, or a
 *     live edit)
 *   - which model to use
 *   - which notes to apply it to
 * and optionally save the live-edited prompt as a new custom prompt for
 * the same property.
 */
export interface GenerateModalOptions {
  /** The property the action writes into. Filters the prompt picker. */
  targetProperty: string;
  matchedRows: NoteRow[];
  tickedRows: NoteRow[];
  /** Active note when invoked outside the rule context. */
  activeFile?: TFile | null;
  /** Default to "active-note" when invoked from a column header on the active note. */
  initialScope?: NoteScope;
}

export class GenerateActionModal extends Modal {
  private opts: GenerateModalOptions;
  private selectedPromptId: string;
  private liveSystemPrompt: string;
  private liveUserPrompt: string;
  private liveParser: GeneratorParserId = "single_line_text";
  private selectedModelId: string | null = null;
  private noteScope: NoteScope;
  private skipIfPropertyExists = false;
  private statusEl: HTMLElement | null = null;
  private runBtn: HTMLButtonElement | null = null;
  private systemTa: HTMLTextAreaElement | null = null;
  private userTa: HTMLTextAreaElement | null = null;
  private parserSelect: HTMLSelectElement | null = null;
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

    // Pick a sensible initial scope.
    if (opts.initialScope) {
      this.noteScope = opts.initialScope;
    } else if (opts.tickedRows.length > 0) {
      this.noteScope = "selected";
    } else if (opts.matchedRows.length > 0) {
      this.noteScope = "matched";
    } else {
      this.noteScope = "active-note";
    }

    // Pick a sensible initial prompt: matching preset for the property,
    // first matching custom prompt, or live.
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

    const enabled = plugin.settings.models.filter((m) => m.enabled);
    this.selectedModelId =
      plugin.settings.defaultModelId &&
      enabled.some((m) => m.id === plugin.settings.defaultModelId)
        ? plugin.settings.defaultModelId
        : (enabled[0]?.id ?? null);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal-content");
    titleEl.setText(`Generate with AI -> ${this.opts.targetProperty}`);

    const enabled = this.plugin.settings.models.filter((m) => m.enabled);
    if (enabled.length === 0) {
      this.renderEmptyState(contentEl);
      return;
    }

    const targets = this.computeTargets();
    const banner = contentEl.createDiv({ cls: "fm-editor-modal-target" });
    banner.createSpan({
      cls: "fm-editor-modal-target-label",
      text: "Target",
    });
    banner.createSpan({
      cls: "fm-editor-modal-target-count",
      text: `${targets.length} ${targets.length === 1 ? "note" : "notes"} -> \`${this.opts.targetProperty}\``,
    });

    // Prompt picker
    new Setting(contentEl)
      .setName("Prompt")
      .setDesc(
        "Pick a built-in preset, a saved custom prompt, or edit the prompt live.",
      )
      .addDropdown((d) => {
        const builtIns = this.plugin.settings.presets.filter(
          (p) => p.targetProperty === this.opts.targetProperty,
        );
        const customs = this.plugin.settings.customPrompts.filter(
          (p) => p.targetProperty === this.opts.targetProperty,
        );
        if (builtIns.length > 0) {
          for (const p of builtIns) {
            d.addOption(`built:${p.id}`, `Default: ${p.displayName}`);
          }
        }
        for (const p of customs) {
          d.addOption(`custom:${p.id}`, `Custom: ${p.name}`);
        }
        d.addOption("live", "Live edit (not saved)");
        d.setValue(this.selectedPromptId);
        d.onChange((v) => {
          this.selectedPromptId = v;
          this.applyPromptChoice();
          this.onOpen();
        });
      });

    // Live system + user prompts (always editable)
    const sysSetting = new Setting(contentEl)
      .setName("System prompt")
      .setDesc("Guardrail. Tells the model the expected output format.");
    sysSetting.controlEl.style.display = "block";
    sysSetting.controlEl.style.width = "100%";
    this.systemTa = sysSetting.controlEl.createEl("textarea", {
      cls: "fm-editor-generator-textarea",
      text: this.liveSystemPrompt,
    });
    this.systemTa.rows = 5;
    this.systemTa.addEventListener("input", () => {
      this.liveSystemPrompt = this.systemTa!.value;
    });

    const userSetting = new Setting(contentEl)
      .setName("User prompt")
      .setDesc(
        "Variables: {{NOTE_BODY}}, {{NOTE_TITLE}}, {{KNOWN_TOPICS}}, {{KNOWN_CONCEPTS}}.",
      );
    userSetting.controlEl.style.display = "block";
    userSetting.controlEl.style.width = "100%";
    this.userTa = userSetting.controlEl.createEl("textarea", {
      cls: "fm-editor-generator-textarea",
      text: this.liveUserPrompt,
    });
    this.userTa.rows = 9;
    this.userTa.addEventListener("input", () => {
      this.liveUserPrompt = this.userTa!.value;
    });

    // Parser
    new Setting(contentEl)
      .setName("Output format")
      .setDesc(
        "How the plugin parses the LLM response. Pick the format that matches the system prompt's output instruction.",
      )
      .addDropdown((d) => {
        d.addOption("single_line_text", "Single-line text (description-style)");
        d.addOption("list_string", "List of strings (tags / keywords)");
        d.addOption(
          "moc_topics_concepts",
          "MoC: topics + concepts (two-key YAML)",
        );
        d.setValue(this.liveParser);
        d.onChange((v) => {
          this.liveParser = v as GeneratorParserId;
        });
        this.parserSelect = d.selectEl;
      });

    // Save as custom
    new Setting(contentEl)
      .setName("Save as custom prompt")
      .setDesc(
        `Save the current System + User + Output format as a reusable custom prompt for \`${this.opts.targetProperty}\`.`,
      )
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

    // Model
    new Setting(contentEl)
      .setName("Model")
      .setDesc("Which configured LLM model to use for this run.")
      .addDropdown((d) => {
        for (const m of enabled) {
          d.addOption(m.id, modelLabel(m));
        }
        if (this.selectedModelId) d.setValue(this.selectedModelId);
        d.onChange((v) => {
          this.selectedModelId = v;
        });
      });

    // Notes scope
    new Setting(contentEl)
      .setName("Notes scope")
      .setDesc("Which notes the action runs on.")
      .addDropdown((d) => {
        const active = this.opts.activeFile ?? this.app.workspace.getActiveFile();
        if (active) d.addOption("active-note", `Active note (${active.basename})`);
        d.addOption(
          "matched",
          `Matched notes (${this.opts.matchedRows.length})`,
        );
        if (this.opts.tickedRows.length > 0) {
          d.addOption(
            "selected",
            `Selected only (${this.opts.tickedRows.length})`,
          );
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

    this.statusEl = contentEl.createDiv({ cls: "fm-editor-modal-status" });

    const footer = contentEl.createDiv({ cls: "fm-editor-modal-footer" });
    const right = footer.createDiv({ cls: "fm-editor-modal-footer-right" });

    const cancel = right.createEl("button", {
      cls: "fm-editor-btn",
      text: "Cancel",
    });
    cancel.addEventListener("click", () => this.close());

    const run = right.createEl("button", { cls: "fm-editor-btn mod-cta" });
    setIcon(run.createSpan(), "sparkles");
    run.createSpan({ text: "Generate" });
    run.addEventListener("click", () => this.runGeneration());
    this.runBtn = run;
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
      text: "No LLM model configured. Open plugin settings to add one.",
    });
    const footer = parent.createDiv({ cls: "fm-editor-modal-footer" });
    const right = footer.createDiv({ cls: "fm-editor-modal-footer-right" });
    const close = right.createEl("button", { text: "Cancel", cls: "fm-editor-btn" });
    close.addEventListener("click", () => this.close());
    const openSettings = right.createEl("button", {
      cls: "fm-editor-btn mod-cta",
    });
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
          frontmatter:
            this.plugin.scanner.readFrontmatter(active) ?? {},
        },
      ];
    }
    return this.opts.matchedRows;
  }

  private async runGeneration(): Promise<void> {
    const model = this.plugin.settings.models.find(
      (m) => m.id === this.selectedModelId,
    );
    if (!model) {
      new Notice("Pick a model");
      return;
    }
    const targets = this.computeTargets();
    if (targets.length === 0) {
      new Notice("No notes in the chosen scope.");
      return;
    }
    if (this.runBtn) this.runBtn.setAttribute("disabled", "true");

    // Build an ad-hoc preset for this run.
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
          if (Array.isArray(o.topics))
            for (const t of o.topics) knownTopics.push(String(t));
          if (Array.isArray(o.concepts))
            for (const c of o.concepts) knownConcepts.push(String(c));
        }
      }
    }

    this.setStatus(`0 / ${files.length} ...`);
    try {
      const result = await this.plugin.generator.run({
        preset: adhoc,
        model,
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

function modelLabel(model: CustomModel): string {
  const display = model.displayName || model.name;
  return `${display}  ·  ${model.provider}`;
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
