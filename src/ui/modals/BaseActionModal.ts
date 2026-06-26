import { App, Modal, Notice, setIcon } from "obsidian";
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
  protected applyBtn: HTMLButtonElement | null = null;

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
    const { contentEl, titleEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal-content");
    titleEl.setText(this.title());

    this.renderTargetBanner(contentEl);

    const form = contentEl.createDiv();
    this.buildForm(form);

    const previewBtnRow = contentEl.createDiv();
    const previewBtn = previewBtnRow.createEl("button", {
      cls: "fm-editor-btn",
    });
    setIcon(previewBtn.createSpan(), "eye");
    previewBtn.createSpan({ text: "Preview changes" });
    previewBtn.addEventListener("click", () => this.runPreview());

    this.statusEl = contentEl.createDiv({ cls: "fm-editor-modal-status" });
    this.previewEl = contentEl.createDiv({ cls: "fm-editor-modal-preview" });

    const footer = contentEl.createDiv({ cls: "fm-editor-modal-footer" });
    const left = footer.createDiv({ cls: "fm-editor-modal-footer-left" });
    const right = footer.createDiv({ cls: "fm-editor-modal-footer-right" });

    const cancelBtn = right.createEl("button", {
      text: "Cancel",
      cls: "fm-editor-btn",
    });
    cancelBtn.addEventListener("click", () => this.close());

    const applyBtn = right.createEl("button", {
      cls: "fm-editor-btn mod-cta",
    });
    setIcon(applyBtn.createSpan(), "check");
    applyBtn.createSpan({
      text: "Apply",
    });
    applyBtn.addEventListener("click", () => this.runApply());
    this.applyBtn = applyBtn;
  }

  private renderTargetBanner(parent: HTMLElement): void {
    const banner = parent.createDiv({ cls: "fm-editor-modal-target" });
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
    this.showUndoableNotice(summary, result.snapshotId ?? null);
    if (result.errors.length > 0) {
      console.warn("frontmatter-editor: errors", result.errors);
    }
    this.onDone();
    if (result.errorCount === 0) {
      this.close();
    } else {
      this.setStatus(
        `Done with errors: ${summary}. Check console. Snapshot: ${result.snapshotId ?? "n/a"}`,
      );
    }
  }

  private showUndoableNotice(summary: string, snapshotId: string | null): void {
    const duration = snapshotId ? 12_000 : 4_000;
    const notice = new Notice("", duration);
    const el = notice.noticeEl ?? notice.containerEl;
    el.empty();
    el.createSpan({ text: `Frontmatter Editor: ${summary}` });
    if (!snapshotId) return;
    const undoBtn = el.createEl("button", {
      text: "Undo",
      cls: "fm-editor-notice-undo",
    });
    undoBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      notice.hide();
      const snap = await this.plugin.snapshots.get(snapshotId);
      if (!snap) {
        new Notice("Snapshot not found.");
        return;
      }
      const undoResult = await this.plugin.bulk.restoreSnapshot(snap);
      new Notice(
        `Undo: ${undoResult.successCount} restored, ${undoResult.errorCount} errors`,
      );
      this.onDone();
    });
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
      `${changed.length} of ${previews.length} notes will change · ${skipped.length} skipped.`,
    );
    const list = this.previewEl.createDiv();
    const shown = changed.slice(0, PREVIEW_LIMIT);
    for (const p of shown) {
      const row = list.createDiv({ cls: "fm-editor-preview-row" });
      row.createDiv({ cls: "fm-editor-preview-path", text: p.path });
      const diff = row.createDiv({ cls: "fm-editor-preview-diff" });
      const before = diff.createDiv({ cls: "fm-editor-preview-before" });
      before.createSpan({ cls: "fm-editor-preview-label", text: "before" });
      before.createSpan({ text: JSON.stringify(p.before) });
      const after = diff.createDiv({ cls: "fm-editor-preview-after" });
      after.createSpan({ cls: "fm-editor-preview-label", text: "after" });
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
