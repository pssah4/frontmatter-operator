import { App, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import type FrontmatterEditorPlugin from "../../main";
import type { NoteRow } from "../../types";
import type {
  GeneratorPreset,
} from "../../types/generators";
import type { ProviderConfig } from "../../types/llm";

export class GenerateActionModal extends Modal {
  private selectedPresetId: string | null = null;
  private selectedProviderId: string | null = null;
  private skipIfPropertyExists = false;
  private statusEl: HTMLElement | null = null;
  private runBtn: HTMLButtonElement | null = null;

  constructor(
    app: App,
    private plugin: FrontmatterEditorPlugin,
    private targets: NoteRow[],
    private onDone: () => void,
  ) {
    super(app);
    this.selectedPresetId = plugin.settings.presets[0]?.id ?? null;
    this.selectedProviderId =
      plugin.settings.defaultProviderId ??
      plugin.settings.providers.find((p) => p.enabled)?.id ??
      null;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal-content");
    titleEl.setText("Generate with AI");

    const enabledProviders = this.plugin.settings.providers.filter(
      (p) => p.enabled,
    );
    if (enabledProviders.length === 0) {
      contentEl.createDiv({
        cls: "fm-editor-modal-hint",
        text: this.plugin.settings.providers.length === 0
          ? "No LLM provider configured yet. Add one to enable the AI generators -- Anthropic, OpenAI, OpenRouter and Custom (OpenAI-compatible incl. Ollama / LM Studio) are supported."
          : "All configured providers are disabled. Re-enable at least one to run the generators.",
      });
      const footer = contentEl.createDiv({ cls: "fm-editor-modal-footer" });
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
      return;
    }

    // Target banner -- mirrors the other action modals.
    const banner = contentEl.createDiv({ cls: "fm-editor-modal-target" });
    banner.createSpan({
      cls: "fm-editor-modal-target-label",
      text: "Rule target",
    });
    banner.createSpan({
      cls: "fm-editor-modal-target-count",
      text: `${this.targets.length} ${this.targets.length === 1 ? "note" : "notes"}`,
    });
    banner.createSpan({
      cls: "fm-editor-modal-target-hint",
      text: "Cancel and adjust the WHEN conditions if this is wrong.",
    });

    new Setting(contentEl)
      .setName("Generator preset")
      .setDesc("Pick which property to write into. Edit prompts in Settings.")
      .addDropdown((d) => {
        for (const p of this.plugin.settings.presets) {
          d.addOption(p.id, p.displayName);
        }
        if (this.selectedPresetId) d.setValue(this.selectedPresetId);
        d.onChange((v) => {
          this.selectedPresetId = v;
        });
      });

    new Setting(contentEl)
      .setName("Provider")
      .setDesc("Which LLM provider to use for this run.")
      .addDropdown((d) => {
        for (const p of enabledProviders) {
          d.addOption(p.id, `${p.displayName} · ${p.defaultModel ?? ""}`);
        }
        if (this.selectedProviderId) d.setValue(this.selectedProviderId);
        d.onChange((v) => {
          this.selectedProviderId = v;
        });
      });

    new Setting(contentEl)
      .setName("Skip notes that already have the target property")
      .setDesc(
        "On = only fill gaps. Off = also process notes that already have a value (existing lists merge, single values are kept).",
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

  private async runGeneration(): Promise<void> {
    const preset = this.plugin.settings.presets.find(
      (p) => p.id === this.selectedPresetId,
    );
    const provider = this.plugin.settings.providers.find(
      (p) => p.id === this.selectedProviderId,
    );
    if (!preset || !provider) {
      new Notice("Pick a preset and a provider");
      return;
    }

    if (this.runBtn) this.runBtn.setAttribute("disabled", "true");

    const files: TFile[] = this.targets.map((r) => r.file);
    const knownTopics: string[] = [];
    const knownConcepts: string[] = [];
    if (preset.parser === "moc_topics_concepts") {
      // Gather existing topics/concepts from the entire vault so the LLM
      // grounds its suggestions in the user's actual taxonomy.
      const rows = this.plugin.scanner.buildAllRows();
      for (const r of rows) {
        const v = r.frontmatter[preset.targetProperty];
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
        preset,
        provider,
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
          `Done with errors. Check developer console for the per-note error log.`,
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
