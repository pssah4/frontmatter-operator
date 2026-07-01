import { App } from "obsidian";
import { DraggableModal } from "./DraggableModal";

export interface ConfirmModalOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

/**
 * Drop-in replacement for window.confirm() with Obsidian-native chrome.
 * Resolves to true if the user clicks Confirm, false otherwise (Cancel,
 * Esc, click outside).
 *
 * HARD-07: replaces blocking confirm() calls so the plugin stays
 * Community-Plugin-Review-Bot compliant and visually consistent.
 */
export function confirmModal(
  app: App,
  options: ConfirmModalOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmModalImpl(app, options, resolve).open();
  });
}

class ConfirmModalImpl extends DraggableModal {
  private decided = false;

  constructor(
    app: App,
    private options: ConfirmModalOptions,
    private resolve: (value: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText(this.options.title);

    contentEl.createDiv({
      cls: "fm-editor-confirm-message",
      text: this.options.message,
    });

    const footer = contentEl.createDiv({
      cls: "fm-editor-modal-footer",
    });
    const right = footer.createDiv({ cls: "fm-editor-modal-footer-right" });

    const cancelBtn = right.createEl("button", {
      cls: "fm-editor-btn",
      text: this.options.cancelLabel ?? "Cancel",
    });
    cancelBtn.addEventListener("click", () => {
      this.decide(false);
    });

    const confirmBtn = right.createEl("button", {
      cls: this.options.destructive
        ? "fm-editor-btn fm-editor-btn-destructive"
        : "fm-editor-btn mod-cta",
      text: this.options.confirmLabel ?? "Confirm",
    });
    confirmBtn.addEventListener("click", () => {
      this.decide(true);
    });

    window.setTimeout(() => confirmBtn.focus(), 0);
  }

  private decide(value: boolean): void {
    this.decided = true;
    this.resolve(value);
    this.close();
  }

  onClose(): void {
    if (!this.decided) {
      this.resolve(false);
    }
    this.contentEl.empty();
  }
}
