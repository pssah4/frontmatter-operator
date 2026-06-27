import { App, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import type FrontmatterEditorPlugin from "../../main";
import type { NoteRow } from "../../types";
import type { CustomModel } from "../../types/llm";

type NoteScope = "matched" | "selected" | "active-note";

export class GenerateActionModal extends Modal {
  private selectedPresetId: string | null = null;
  private selectedModelId: string | null = null;
  private noteScope: NoteScope = "matched";
  private skipIfPropertyExists = false;
  private statusEl: HTMLElement | null = null;
  private runBtn: HTMLButtonElement | null = null;

  constructor(
    app: App,
    private plugin: FrontmatterEditorPlugin,
    /** matched rows (WHEN + FILTER applied). */
    private matchedRows: NoteRow[],
    /** rows the user explicitly ticked in the table. Empty when none. */
    private tickedRows: NoteRow[],
    private onDone: () => void,
  ) {
    super(app);
    this.selectedPresetId = plugin.settings.presets[0]?.id ?? null;
    const enabledModels = plugin.settings.models.filter((m) => m.enabled);
    this.selectedModelId =
      plugin.settings.defaultModelId &&
      enabledModels.some((m) => m.id === plugin.settings.defaultModelId)
        ? plugin.settings.defaultModelId
        : (enabledModels[0]?.id ?? null);
    if (tickedRows.length > 0) this.noteScope = "selected";
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal-content");
    titleEl.setText("Generate with AI");

    const enabledModels = this.plugin.settings.models.filter((m) => m.enabled);
    if (enabledModels.length === 0) {
      this.renderEmptyState(contentEl);
      return;
    }

    // Target banner
    const targets = this.computeTargets();
    const banner = contentEl.createDiv({ cls: "fm-editor-modal-target" });
    banner.createSpan({
      cls: "fm-editor-modal-target-label",
      text: "Run target",
    });
    banner.createSpan({
      cls: "fm-editor-modal-target-count",
      text: `${targets.length} ${targets.length === 1 ? "note" : "notes"}`,
    });
    banner.createSpan({
      cls: "fm-editor-modal-target-hint",
      text: "Pick a category and notes scope below. A snapshot is not written for AI-generated content -- only modified frontmatter values are applied via processFrontMatter.",
    });

    // Category / preset
    new Setting(contentEl)
      .setName("Category (preset)")
      .setDesc(
        "Which built-in or custom generator to run. Each preset writes into a specific property.",
      )
      .addDropdown((d) => {
        for (const p of this.plugin.settings.presets) {
          d.addOption(p.id, `${p.displayName} -> ${p.targetProperty}`);
        }
        if (this.selectedPresetId) d.setValue(this.selectedPresetId);
        d.onChange((v) => {
          this.selectedPresetId = v;
          this.onOpen();
        });
      });

    // Notes scope
    new Setting(contentEl)
      .setName("Notes scope")
      .setDesc("Which notes to process.")
      .addDropdown((d) => {
        d.addOption("matched", `Matched notes (${this.matchedRows.length})`);
        if (this.tickedRows.length > 0) {
          d.addOption("selected", `Selected only (${this.tickedRows.length})`);
        }
        const active = this.app.workspace.getActiveFile();
        if (active) d.addOption("active-note", `Active note (${active.basename})`);
        d.setValue(this.noteScope);
        d.onChange((v) => {
          this.noteScope = v as NoteScope;
          this.onOpen();
        });
      });

    // Model
    new Setting(contentEl)
      .setName("Model")
      .setDesc("Which configured LLM model to use for this run.")
      .addDropdown((d) => {
        for (const m of enabledModels) {
          d.addOption(m.id, modelLabel(m));
        }
        if (this.selectedModelId) d.setValue(this.selectedModelId);
        d.onChange((v) => {
          this.selectedModelId = v;
        });
      });

    new Setting(contentEl)
      .setName("Skip notes that already have the target property")
      .setDesc(
        "On = only fill gaps. Off = process all matched notes (lists merge, single values are preserved when present).",
      )
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

    const run = right.createEl("button", {
      cls: "fm-editor-btn mod-cta",
    });
    setIcon(run.createSpan(), "sparkles");
    run.createSpan({ text: "Generate" });
    run.addEventListener("click", () => this.runGeneration());
    this.runBtn = run;
  }

  private renderEmptyState(parent: HTMLElement): void {
    parent.createDiv({
      cls: "fm-editor-modal-hint",
      text:
        this.plugin.settings.models.length === 0
          ? "No LLM model configured. Add one in plugin settings -- 12 providers are supported (Anthropic, OpenAI, Gemini, Ollama, LM Studio, OpenRouter, Azure, GitHub Copilot, Kilo Gateway, Amazon Bedrock, ChatGPT OAuth, Custom)."
          : "All configured models are disabled. Re-enable at least one to run the generators.",
    });
    const footer = parent.createDiv({ cls: "fm-editor-modal-footer" });
    const right = footer.createDiv({ cls: "fm-editor-modal-footer-right" });
    const close = right.createEl("button", {
      text: "Cancel",
      cls: "fm-editor-btn",
    });
    close.addEventListener("click", () => this.close());
    const openSettings = right.createEl("button", {
      cls: "fm-editor-btn mod-cta",
    });
    setIcon(openSettings.createSpan(), "settings");
    openSettings.createSpan({ text: "Open plugin settings" });
    openSettings.addEventListener("click", () => {
      const setting = (this.app as unknown as {
        setting?: {
          open: () => void;
          openTabById: (id: string) => void;
        };
      }).setting;
      if (!setting) {
        new Notice("Settings panel not available.");
        return;
      }
      this.close();
      setting.open();
      setting.openTabById(this.plugin.manifest.id);
    });
  }

  private computeTargets(): NoteRow[] {
    if (this.noteScope === "selected") return this.tickedRows;
    if (this.noteScope === "active-note") {
      const active = this.app.workspace.getActiveFile();
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
    return this.matchedRows;
  }

  private async runGeneration(): Promise<void> {
    const preset = this.plugin.settings.presets.find(
      (p) => p.id === this.selectedPresetId,
    );
    const model = this.plugin.settings.models.find(
      (m) => m.id === this.selectedModelId,
    );
    if (!preset || !model) {
      new Notice("Pick a category and a model");
      return;
    }
    const targets = this.computeTargets();
    if (targets.length === 0) {
      new Notice("No notes in the chosen scope.");
      return;
    }
    if (this.runBtn) this.runBtn.setAttribute("disabled", "true");

    const files: TFile[] = targets.map((r) => r.file);
    const knownTopics: string[] = [];
    const knownConcepts: string[] = [];
    if (preset.parser === "moc_topics_concepts") {
      const rows = this.plugin.scanner.buildAllRows();
      for (const r of rows) {
        const v = r.frontmatter[preset.targetProperty];
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
        preset,
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
        this.setStatus(
          "Done with errors. Check developer console for the per-note error log.",
        );
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
  const provider = model.provider;
  const display = model.displayName || model.name;
  return `${display}  ·  ${provider}`;
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
