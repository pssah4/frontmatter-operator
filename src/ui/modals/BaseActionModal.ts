import { App, Modal, Notice } from "obsidian";
import type FrontmatterEditorPlugin from "../../main";
import type {
  ActionPreview,
  BulkAction,
  NoteRow,
  PropertyStat,
} from "../../types";

const PREVIEW_LIMIT = 100;

export abstract class BaseActionModal extends Modal {
  protected previewEl: HTMLElement | null = null;
  protected statusEl: HTMLElement | null = null;

  constructor(
    app: App,
    protected plugin: FrontmatterEditorPlugin,
    protected targets: NoteRow[],
    protected inventory: PropertyStat[],
    protected onDone: () => void,
  ) {
    super(app);
  }

  protected abstract title(): string;
  protected abstract buildForm(container: HTMLElement): void;
  protected abstract buildAction(): BulkAction | { error: string };

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal");
    contentEl.createEl("h2", { text: this.title() });

    const target = contentEl.createDiv({ cls: "fm-editor-modal-target" });
    target.createSpan({
      cls: "fm-editor-modal-target-label",
      text: "Rule target:",
    });
    target.createSpan({
      cls: "fm-editor-modal-target-count",
      text: `${this.targets.length} note${this.targets.length === 1 ? "" : "s"}`,
    });
    target.createSpan({
      cls: "fm-editor-modal-target-hint",
      text: "from the current filter selection. Cancel and adjust filters if this is wrong.",
    });

    const form = contentEl.createDiv({ cls: "fm-editor-modal-form" });
    this.buildForm(form);

    const previewBtnRow = contentEl.createDiv({ cls: "fm-editor-modal-row" });
    const previewBtn = previewBtnRow.createEl("button", {
      text: "Preview changes",
      cls: "fm-editor-btn",
    });
    previewBtn.addEventListener("click", () => this.runPreview());

    this.statusEl = contentEl.createDiv({ cls: "fm-editor-modal-status" });
    this.previewEl = contentEl.createDiv({ cls: "fm-editor-modal-preview" });

    const footer = contentEl.createDiv({ cls: "fm-editor-modal-footer" });
    const cancelBtn = footer.createEl("button", {
      text: "Cancel",
      cls: "fm-editor-btn",
    });
    cancelBtn.addEventListener("click", () => this.close());
    const applyBtn = footer.createEl("button", {
      text: `Apply to ${this.targets.length} notes`,
      cls: "fm-editor-btn fm-editor-btn-primary",
    });
    applyBtn.addEventListener("click", () => this.runApply());
  }

  protected runPreview(): void {
    const built = this.buildAction();
    if ("error" in built) {
      new Notice(built.error);
      return;
    }
    const previews = this.plugin.bulk.previewAction(this.targets, built);
    this.renderPreview(previews);
  }

  protected async runApply(): Promise<void> {
    const built = this.buildAction();
    if ("error" in built) {
      new Notice(built.error);
      return;
    }
    if (!confirm(`Apply action to ${this.targets.length} note(s)?`)) return;

    this.setStatus(`Writing 0 / ${this.targets.length} ...`);
    const result = await this.plugin.bulk.executeAction(
      this.targets,
      built,
      (current, total) => {
        this.setStatus(`Writing ${current} / ${total} ...`);
      },
    );
    const parts = [
      `${result.successCount} changed`,
      `${result.skippedCount} skipped`,
      result.errorCount > 0 ? `${result.errorCount} errors` : null,
    ].filter(Boolean);
    const summary = parts.join(", ");
    new Notice(`Frontmatter Editor: ${summary}`);
    if (result.errors.length > 0) {
      console.warn("frontmatter-editor: errors", result.errors);
    }
    this.setStatus(`Done. ${summary}. Snapshot: ${result.snapshotId ?? "n/a"}`);
    this.onDone();
  }

  protected setStatus(text: string): void {
    if (this.statusEl) this.statusEl.setText(text);
  }

  protected renderPreview(previews: ActionPreview[]): void {
    if (!this.previewEl) return;
    this.previewEl.empty();
    const changed = previews.filter((p) => p.changed);
    const skipped = previews.filter((p) => !p.changed);
    const summary = this.previewEl.createDiv({
      cls: "fm-editor-preview-summary",
    });
    summary.setText(
      `${changed.length} of ${previews.length} notes will change. ${skipped.length} will be skipped.`,
    );
    const list = this.previewEl.createDiv({ cls: "fm-editor-preview-list" });
    const shown = changed.slice(0, PREVIEW_LIMIT);
    for (const p of shown) {
      const row = list.createDiv({ cls: "fm-editor-preview-row" });
      row.createDiv({ cls: "fm-editor-preview-path", text: p.path });
      const diff = row.createDiv({ cls: "fm-editor-preview-diff" });
      const before = diff.createDiv({ cls: "fm-editor-preview-before" });
      before.createSpan({ cls: "fm-editor-preview-label", text: "before " });
      before.createSpan({ text: JSON.stringify(p.before) });
      const after = diff.createDiv({ cls: "fm-editor-preview-after" });
      after.createSpan({ cls: "fm-editor-preview-label", text: "after  " });
      after.createSpan({ text: JSON.stringify(p.after) });
    }
    if (changed.length > PREVIEW_LIMIT) {
      list.createDiv({
        cls: "fm-editor-empty-hint",
        text: `Showing first ${PREVIEW_LIMIT} of ${changed.length} changed notes.`,
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  protected propertyDatalist(parent: HTMLElement, id: string): void {
    const dl = parent.createEl("datalist");
    dl.id = id;
    for (const p of this.inventory) {
      dl.createEl("option", { value: p.name });
    }
  }
}
