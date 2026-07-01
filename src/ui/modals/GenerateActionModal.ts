import { App, Notice, TFile, setIcon } from "obsidian";
import { DraggableModal } from "./DraggableModal";
import { promptModal } from "./PromptModal";
import type FrontmatterEditorPlugin from "../../main";
import type { NoteRow } from "../../types";
import type {
  CustomPromptTemplate,
  GeneratorLanguage,
  GeneratorParserId,
  GeneratorPreset,
} from "../../types/generators";
import { GENERATOR_LANGUAGES } from "../../types/generators";
import {
  MODEL_SUGGESTIONS,
  PROVIDER_LABELS,
  type ProviderConfig,
} from "../../types/llm";
import type { GeneratorConflictMode } from "../../services/generator/GeneratorService";

type NoteScope = "matched" | "selected" | "active-note";

export interface GenerateModalOptions {
  targetProperty: string;
  matchedRows: NoteRow[];
  tickedRows: NoteRow[];
  activeFile?: TFile | null;
  initialScope?: NoteScope;
}

/**
 * Minimal chat-style generator. Three inputs only:
 *   1. NOTES SCOPE  -- which notes the action runs on
 *   2. PROMPT       -- pick a preset or type free-form (chat-window UX)
 *   3. MODEL        -- which provider + model
 *
 * Decode parameters and output-format pickers live elsewhere (preset
 * defaults). Save-as-custom is a small button in the prompt toolbar.
 */
export class GenerateActionModal extends DraggableModal {
  private opts: GenerateModalOptions;
  private noteScope: NoteScope;
  private promptText: string;
  private selectedPresetId: string | null = null;
  private parser: GeneratorParserId = "single_line_text";
  private selectedProviderModel: string;
  private statusEl: HTMLElement | null = null;
  private promptInputEl: HTMLTextAreaElement | null = null;
  private chatLogEl: HTMLElement | null = null;
  private onDone: () => void;
  /**
   * What to do for notes that ALREADY have a non-empty value in the
   * target property. Default "skip" -- safest for re-runs, preserves
   * existing data. User picks via the conflict toggle in the toolbar.
   */
  private conflictMode: GeneratorConflictMode = "skip";

  constructor(
    app: App,
    private plugin: FrontmatterEditorPlugin,
    opts: GenerateModalOptions,
    onDone: () => void,
  ) {
    super(app);
    this.opts = opts;
    this.onDone = onDone;

    // Default scope: if user has ticked rows use those, else matched, else active note.
    if (opts.initialScope) this.noteScope = opts.initialScope;
    else if (opts.tickedRows.length > 0) this.noteScope = "selected";
    else if (opts.matchedRows.length > 0) this.noteScope = "matched";
    else this.noteScope = "active-note";

    // Default prompt: first matching built-in preset for this property.
    const builtIn = plugin.settings.presets.find(
      (p) => p.targetProperty === opts.targetProperty,
    );
    if (builtIn) {
      this.selectedPresetId = `built:${builtIn.id}`;
      const lang = plugin.settings.generatorLanguage;
      this.promptText = builtIn.prompts[lang];
      this.parser = builtIn.parser;
    } else {
      this.promptText = `Generate a concise value for the "${opts.targetProperty}" frontmatter property based on the note content.\n\nNote content:\n{{NOTE_BODY}}`;
    }

    // Pre-select default provider+model (last-used per provider sticky).
    this.selectedProviderModel = this.firstAvailableProviderModel();
  }

  private firstAvailableProviderModel(): string {
    const def = this.plugin.settings.defaultProviderId;
    const enabled = this.plugin.settings.providers.filter((p) => p.enabled);
    if (enabled.length === 0) return "";
    const provider = enabled.find((p) => p.id === def) ?? enabled[0];
    const lastModel = this.plugin.settings.lastUsedModelByProvider[provider.id];
    const fallback = pickAnyModel(provider);
    return encode(provider.id, lastModel || fallback);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal-content");
    contentEl.addClass("fm-editor-chat-modal");
    titleEl.setText(`Generate with AI -> ${this.opts.targetProperty}`);

    const enabledProviders = this.plugin.settings.providers.filter((p) => p.enabled);
    if (enabledProviders.length === 0) {
      this.renderEmptyState(contentEl);
      return;
    }

    // ============== TOOLBAR (3 inputs in one compact row) ==============
    const toolbar = contentEl.createDiv({ cls: "fm-editor-chat-toolbar" });

    // Notes scope
    const scopeWrap = toolbar.createDiv({ cls: "fm-editor-chat-tool" });
    setIcon(scopeWrap.createSpan({ cls: "fm-editor-chat-tool-icon" }), "files");
    const scopeSelect = scopeWrap.createEl("select");
    const active = this.opts.activeFile ?? this.app.workspace.getActiveFile();
    if (active) {
      scopeSelect.createEl("option", {
        value: "active-note",
        text: `Active note (${active.basename})`,
      });
    }
    scopeSelect.createEl("option", {
      value: "matched",
      text: `Filter matches (${this.opts.matchedRows.length})`,
    });
    if (this.opts.tickedRows.length > 0) {
      scopeSelect.createEl("option", {
        value: "selected",
        text: `Selected only (${this.opts.tickedRows.length})`,
      });
    }
    scopeSelect.value = this.noteScope;
    scopeSelect.addEventListener("change", () => {
      this.noteScope = scopeSelect.value as NoteScope;
    });

    // Prompt preset picker
    const presetWrap = toolbar.createDiv({ cls: "fm-editor-chat-tool" });
    setIcon(presetWrap.createSpan({ cls: "fm-editor-chat-tool-icon" }), "message-square");
    const presetSelect = presetWrap.createEl("select");
    const builtIns = this.plugin.settings.presets.filter(
      (p) => p.targetProperty === this.opts.targetProperty && p.enabled !== false,
    );
    const customs = this.plugin.settings.customPrompts.filter(
      (p) => p.targetProperty === this.opts.targetProperty && p.enabled !== false,
    );
    // "A prompt is a prompt": built-in and saved prompts appear uniformly by
    // name, no "Preset:"/"Custom:" prefixes.
    for (const p of builtIns) presetSelect.createEl("option", { value: `built:${p.id}`, text: p.displayName });
    for (const p of customs) presetSelect.createEl("option", { value: `custom:${p.id}`, text: p.name });
    presetSelect.createEl("option", { value: "live", text: "Ad-hoc prompt (not saved)" });
    if (this.selectedPresetId) presetSelect.value = this.selectedPresetId;
    presetSelect.addEventListener("change", () => {
      this.selectedPresetId = presetSelect.value;
      this.applyPromptChoice();
      if (this.promptInputEl) this.promptInputEl.value = this.promptText;
    });

    // Model picker
    const modelWrap = toolbar.createDiv({ cls: "fm-editor-chat-tool" });
    setIcon(modelWrap.createSpan({ cls: "fm-editor-chat-tool-icon" }), "cpu");
    const modelSelect = modelWrap.createEl("select");
    for (const p of enabledProviders) {
      const cached = p.discoveredModels ?? [];
      const statics = MODEL_SUGGESTIONS[p.type] ?? [];
      const items =
        cached.length > 0
          ? cached.map((c) => ({ id: c.id, label: c.label }))
          : statics.map((s) => ({ id: s.id, label: s.label }));
      if (items.length === 0) continue;
      const og = modelSelect.createEl("optgroup");
      og.label = `${p.displayName} · ${PROVIDER_LABELS[p.type]}`;
      for (const it of items) {
        og.createEl("option", {
          value: encode(p.id, it.id),
          text: it.label,
        });
      }
    }
    if (this.selectedProviderModel) modelSelect.value = this.selectedProviderModel;
    modelSelect.addEventListener("change", () => {
      this.selectedProviderModel = modelSelect.value;
    });

    // Conflict picker -- behaviour when target property already has a value.
    const conflictWrap = toolbar.createDiv({ cls: "fm-editor-chat-tool" });
    setIcon(conflictWrap.createSpan({ cls: "fm-editor-chat-tool-icon" }), "shield-check");
    const conflictSelect = conflictWrap.createEl("select");
    conflictSelect.title = "If the target property already has a value";
    conflictSelect.createEl("option", {
      value: "skip",
      text: "Skip notes with existing value",
    });
    conflictSelect.createEl("option", {
      value: "append",
      text: "Append to existing value",
    });
    conflictSelect.createEl("option", {
      value: "overwrite",
      text: "Overwrite existing value",
    });
    conflictSelect.value = this.conflictMode;
    conflictSelect.addEventListener("change", () => {
      this.conflictMode = conflictSelect.value as GeneratorConflictMode;
    });

    // ============== CHAT WINDOW ==============
    this.chatLogEl = contentEl.createDiv({ cls: "fm-editor-chat-log" });
    this.renderInfoBubble();

    // ============== INPUT ==============
    const inputWrap = contentEl.createDiv({ cls: "fm-editor-chat-input-wrap" });
    const input = inputWrap.createEl("textarea", {
      cls: "fm-editor-chat-input",
      placeholder: "Type your prompt. Use {{NOTE_BODY}} / {{NOTE_TITLE}} / {{KNOWN_TOPICS}} / {{KNOWN_CONCEPTS}} as variables.",
    });
    input.value = this.promptText;
    input.rows = 4;
    input.addEventListener("input", () => {
      this.promptText = input.value;
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        void this.runGeneration();
      }
    });
    this.promptInputEl = input;

    // ============== FOOTER ==============
    const footer = contentEl.createDiv({ cls: "fm-editor-modal-footer" });
    const left = footer.createDiv({ cls: "fm-editor-modal-footer-left" });
    const save = left.createEl("button", { cls: "fm-editor-btn" });
    setIcon(save.createSpan(), "bookmark-plus");
    save.createSpan({ text: "Save as custom prompt" });
    save.addEventListener("click", () => this.saveAsCustomPrompt());

    this.statusEl = left.createDiv({ cls: "fm-editor-modal-status" });

    const right = footer.createDiv({ cls: "fm-editor-modal-footer-right" });
    const cancel = right.createEl("button", { cls: "fm-editor-btn", text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const run = right.createEl("button", { cls: "fm-editor-btn mod-cta" });
    setIcon(run.createSpan(), "sparkles");
    run.createSpan({ text: "Generate" });
    run.addEventListener("click", () => this.runGeneration());
  }

  private renderInfoBubble(): void {
    if (!this.chatLogEl) return;
    this.chatLogEl.empty();
    const targets = this.computeTargets();
    const bubble = this.chatLogEl.createDiv({ cls: "fm-editor-chat-bubble fm-editor-chat-bubble-system" });
    bubble.createDiv({
      cls: "fm-editor-chat-bubble-label",
      text: "Plan",
    });
    bubble.createDiv({
      cls: "fm-editor-chat-bubble-text",
      text: `Generate "${this.opts.targetProperty}" for ${targets.length} ${targets.length === 1 ? "note" : "notes"} with the prompt below.`,
    });
  }

  private appendChat(role: "user" | "assistant", text: string): void {
    if (!this.chatLogEl) return;
    const bubble = this.chatLogEl.createDiv({
      cls: `fm-editor-chat-bubble fm-editor-chat-bubble-${role}`,
    });
    bubble.createDiv({
      cls: "fm-editor-chat-bubble-label",
      text: role === "user" ? "You" : "Assistant",
    });
    bubble.createDiv({
      cls: "fm-editor-chat-bubble-text",
      text,
    });
    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  private applyPromptChoice(): void {
    if (!this.selectedPresetId) return;
    if (this.selectedPresetId.startsWith("built:")) {
      const id = this.selectedPresetId.slice("built:".length);
      const preset = this.plugin.settings.presets.find((p) => p.id === id);
      if (preset) {
        const lang = this.plugin.settings.generatorLanguage;
        this.promptText = preset.prompts[lang];
        this.parser = preset.parser;
      }
    } else if (this.selectedPresetId.startsWith("custom:")) {
      const id = this.selectedPresetId.slice("custom:".length);
      const tpl = this.plugin.settings.customPrompts.find((p) => p.id === id);
      if (tpl) {
        this.promptText = tpl.prompt;
        this.parser = tpl.parser;
      }
    }
  }

  private async saveAsCustomPrompt(): Promise<void> {
    const name = await promptModal(this.app, {
      title: "Save as custom prompt",
      message: "A reusable name for this prompt. It appears in Settings and in the preset dropdown.",
      placeholder: "e.g. Short German summary",
      initialValue: `My ${this.opts.targetProperty}`,
      confirmLabel: "Save",
    });
    if (!name) return;
    const { emptyCustomPrompt } = await import("../../types/generators");
    const tpl: CustomPromptTemplate = emptyCustomPrompt(this.opts.targetProperty);
    tpl.name = name;
    tpl.prompt = this.promptText;
    tpl.parser = this.parser;
    this.plugin.settings.customPrompts.push(tpl);
    await this.plugin.saveSettings();
    new Notice(`Saved "${name}".`);
    this.selectedPresetId = `custom:${tpl.id}`;
    this.onOpen();
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
    const decoded = decode(this.selectedProviderModel);
    if (!decoded) {
      new Notice("Pick a model");
      return;
    }
    const provider = this.plugin.settings.providers.find((p) => p.id === decoded.providerId);
    if (!provider) {
      new Notice("Provider not found");
      return;
    }
    const targets = this.computeTargets();
    if (targets.length === 0) {
      new Notice("No notes in the chosen scope.");
      return;
    }

    // Persist last-used model per provider.
    this.plugin.settings.lastUsedModelByProvider[provider.id] = decoded.modelId;
    await this.plugin.saveSettings();

    this.appendChat("user", this.promptText);

    // Build an ad-hoc preset for this run.
    const adhoc: GeneratorPreset = {
      id: "adhoc",
      displayName: "Ad-hoc",
      targetProperty: this.opts.targetProperty,
      description: "",
      parser: this.parser,
      isBuiltIn: false,
      // Same prompt text wired across every supported language so the
      // ad-hoc preset works regardless of the user's current
      // settings.generatorLanguage. The Generate-with-AI modal sends
      // one prompt; the language picker doesn't apply here because the
      // user already wrote the prompt in whatever language they
      // wanted.
      prompts: Object.fromEntries(
        GENERATOR_LANGUAGES.map((lang) => [lang, this.promptText]),
      ) as Record<GeneratorLanguage, string>,
    };

    const files: TFile[] = targets.map((r) => r.file);
    const knownTopics: string[] = [];
    const knownConcepts: string[] = [];
    if (this.parser === "moc_topics_concepts") {
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

    this.setStatus(`Running 0 / ${files.length}...`);
    try {
      const result = await this.plugin.generator.run({
        preset: adhoc,
        provider,
        model: { modelId: decoded.modelId },
        language: this.plugin.settings.generatorLanguage,
        targets: files,
        conflictMode: this.conflictMode,
        knownTopics,
        knownConcepts,
        onProgress: (current, total, file) => {
          this.setStatus(`${current} / ${total}  ·  ${file.basename}`);
        },
      });
      const parts = [
        `${result.successCount} generated`,
        result.skippedCount > 0 ? `${result.skippedCount} skipped` : null,
        result.errorCount > 0 ? `${result.errorCount} errors` : null,
      ].filter(Boolean);
      this.appendChat("assistant", parts.join(", "));
      this.setStatus("Done.");
      new Notice(`Generator: ${parts.join(", ")}`);
      // Show the first few skip reasons in the chat log so the user
      // sees WHY notes were left untouched (empty body, LLM refused,
      // parse error, conflict-mode skip, ...).
      if (result.skipped.length > 0) {
        const grouped = groupSkipsByReason(result.skipped);
        for (const g of grouped.slice(0, 5)) {
          this.appendChat(
            "assistant",
            `Skipped ${g.count} note${g.count === 1 ? "" : "s"}: ${g.reason}${g.examples.length ? ` (e.g. ${g.examples.join(", ")})` : ""}`,
          );
        }
      }
      if (result.errors.length > 0) {
        console.warn("frontmatter-operator: generator errors", result.errors);
        for (const err of result.errors.slice(0, 5)) {
          this.appendChat("assistant", `Error in ${err.path}: ${err.message}`);
        }
      }
      this.onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.appendChat("assistant", `Failed: ${message}`);
      this.setStatus(`Failed`);
      new Notice(`Generator failed: ${message}`);
    }
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.setText(text);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function pickAnyModel(provider: ProviderConfig): string {
  if (provider.discoveredModels && provider.discoveredModels[0]) {
    return provider.discoveredModels[0].id;
  }
  const statics = MODEL_SUGGESTIONS[provider.type] ?? [];
  return statics[0]?.id ?? "";
}

function encode(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

function decode(combined: string): { providerId: string; modelId: string } | null {
  const idx = combined.indexOf("::");
  if (idx < 0) return null;
  return {
    providerId: combined.slice(0, idx),
    modelId: combined.slice(idx + 2),
  };
}

/**
 * Collapse the per-note skipped[] list into one entry per distinct
 * reason so the chat log shows a short summary instead of N
 * identical "skipped X" lines. Each group carries up to 3 example
 * paths so the user can spot which notes were affected.
 */
function groupSkipsByReason(
  skipped: Array<{ path: string; reason: string }>,
): Array<{ reason: string; count: number; examples: string[] }> {
  const map = new Map<string, { reason: string; count: number; examples: string[] }>();
  for (const s of skipped) {
    const key = s.reason;
    let g = map.get(key);
    if (!g) {
      g = { reason: s.reason, count: 0, examples: [] };
      map.set(key, g);
    }
    g.count++;
    if (g.examples.length < 3) {
      const base = s.path.split("/").pop()?.replace(/\.md$/, "") ?? s.path;
      g.examples.push(base);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}
