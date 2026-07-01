import { App } from "obsidian";
import { DraggableModal } from "./DraggableModal";

export interface PromptModalOptions {
  title: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * Drop-in replacement for window.prompt() with Obsidian-native chrome.
 * Electron disables window.prompt() (it always returns null), so any code
 * relying on it silently does nothing -- this modal restores a working text
 * prompt. Resolves to the trimmed input on confirm, or null on Cancel / Esc /
 * click-outside / empty input.
 */
export function promptModal(
  app: App,
  options: PromptModalOptions,
): Promise<string | null> {
  return new Promise((resolve) => {
    new PromptModalImpl(app, options, resolve).open();
  });
}

class PromptModalImpl extends DraggableModal {
  private decided = false;

  constructor(
    app: App,
    private options: PromptModalOptions,
    private resolve: (value: string | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal-content");
    titleEl.setText(this.options.title);

    if (this.options.message) {
      contentEl.createDiv({
        cls: "fm-editor-modal-hint",
        text: this.options.message,
      });
    }

    const input = contentEl.createEl("input", {
      type: "text",
      cls: "fm-editor-filter-input",
    });
    input.placeholder = this.options.placeholder ?? "";
    input.value = this.options.initialValue ?? "";

    const commit = (): void => {
      const value = input.value.trim();
      this.decide(value.length > 0 ? value : null);
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commit();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        this.decide(null);
      }
    });

    const footer = contentEl.createDiv({ cls: "fm-editor-modal-footer" });
    const right = footer.createDiv({ cls: "fm-editor-modal-footer-right" });

    const cancelBtn = right.createEl("button", {
      cls: "fm-editor-btn",
      text: this.options.cancelLabel ?? "Cancel",
    });
    cancelBtn.addEventListener("click", () => this.decide(null));

    const okBtn = right.createEl("button", {
      cls: "fm-editor-btn mod-cta",
      text: this.options.confirmLabel ?? "Save",
    });
    okBtn.addEventListener("click", commit);

    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  private decide(value: string | null): void {
    this.decided = true;
    this.resolve(value);
    this.close();
  }

  onClose(): void {
    if (!this.decided) this.resolve(null);
    this.contentEl.empty();
  }
}
