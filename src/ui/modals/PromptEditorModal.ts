import { App, Notice, Setting } from "obsidian";
import { DraggableModal } from "./DraggableModal";
import type { GeneratorParserId } from "../../types/generators";

export interface PromptDraft {
  name: string;
  targetProperty: string;
  parser: GeneratorParserId;
  text: string;
}

export interface PromptEditorOptions {
  title: string;
  draft: PromptDraft;
  /** Shown next to the Prompt label, e.g. which language is being edited. */
  languageNote?: string;
  onSave: (draft: PromptDraft) => Promise<void> | void;
  /** When provided, a "Reset to default" button is shown (built-in prompts). */
  onReset?: () => Promise<void> | void;
}

const PARSER_LABELS: Record<GeneratorParserId, string> = {
  single_line_text: "Single line of text",
  list_string: "List of values",
  moc_topics_concepts: "Map of content (topics + concepts)",
};

const VARIABLES_TIP =
  "Runs once per note. Variables: {{NOTE_BODY}}, {{NOTE_TITLE}}, {{KNOWN_TOPICS}}, {{KNOWN_CONCEPTS}}. A fixed safety guardrail (refusal sentinel, output-only policy) is appended automatically.";

/**
 * One editor for every prompt, built-in or custom -- there is no visible
 * difference between the two. Edits name, target property, output format and
 * the prompt text; built-in prompts additionally offer "Reset to default".
 */
export class PromptEditorModal extends DraggableModal {
  private draft: PromptDraft;

  constructor(app: App, private options: PromptEditorOptions) {
    super(app);
    this.draft = { ...options.draft };
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal-content");
    titleEl.setText(this.options.title);

    new Setting(contentEl).setName("Name").addText((t) =>
      t.setValue(this.draft.name).onChange((v) => {
        this.draft.name = v;
      }),
    );

    new Setting(contentEl)
      .setName("Target property")
      .setDesc("The frontmatter key this prompt writes to.")
      .addText((t) =>
        t
          .setPlaceholder("Example: description")
          .setValue(this.draft.targetProperty)
          .onChange((v) => {
            this.draft.targetProperty = v.trim();
          }),
      );

    new Setting(contentEl).setName("Output format").addDropdown((d) => {
      (Object.keys(PARSER_LABELS) as GeneratorParserId[]).forEach((k) => {
        d.addOption(k, PARSER_LABELS[k]);
      });
      d.setValue(this.draft.parser);
      d.onChange((v) => {
        this.draft.parser = v as GeneratorParserId;
      });
    });

    const label = contentEl.createDiv({ cls: "fm-editor-prompt-field-label" });
    label.createSpan({ text: "Prompt" });
    if (this.options.languageNote) {
      label.createSpan({
        cls: "fm-editor-prompt-lang-note",
        text: this.options.languageNote,
      });
    }

    const ta = contentEl.createEl("textarea", {
      cls: "fm-editor-generator-textarea",
      text: this.draft.text,
    });
    ta.rows = 14;
    ta.addEventListener("change", () => {
      this.draft.text = ta.value;
    });

    contentEl.createDiv({ cls: "fm-editor-modal-hint", text: VARIABLES_TIP });

    const footer = contentEl.createDiv({ cls: "fm-editor-modal-footer" });
    const left = footer.createDiv({ cls: "fm-editor-modal-footer-left" });
    if (this.options.onReset) {
      const reset = left.createEl("button", {
        cls: "fm-editor-btn mod-warning",
        text: "Reset to default",
      });
      reset.addEventListener("click", () => {
        void this.handleReset();
      });
    }

    const right = footer.createDiv({ cls: "fm-editor-modal-footer-right" });
    const cancel = right.createEl("button", {
      cls: "fm-editor-btn",
      text: "Cancel",
    });
    cancel.addEventListener("click", () => this.close());
    const save = right.createEl("button", {
      cls: "fm-editor-btn mod-cta",
      text: "Save",
    });
    save.addEventListener("click", () => {
      void this.handleSave(ta);
    });
  }

  private async handleReset(): Promise<void> {
    await this.options.onReset?.();
    this.close();
  }

  private async handleSave(ta: HTMLTextAreaElement): Promise<void> {
    this.draft.text = ta.value;
    if (!this.draft.name.trim()) {
      new Notice("Name is required");
      return;
    }
    if (!this.draft.targetProperty.trim()) {
      new Notice("Target property is required");
      return;
    }
    await this.options.onSave({ ...this.draft });
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
