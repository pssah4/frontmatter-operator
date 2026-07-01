import { App, Notice } from "obsidian";
import { DraggableModal } from "./DraggableModal";
import { openExternal } from "../../auth/openExternal";

export interface OAuthProgressOptions {
  title: string;
  /** Shown above the action area while waiting. */
  description: string;
  /** Initial status line ("Waiting for the device code..."). */
  initialStatus?: string;
}

/**
 * Visible progress UI for OAuth flows. The flow code receives a controller
 * that can:
 *   - show the user code and verification URL,
 *   - update the status line during polling,
 *   - close the modal on success/failure.
 *
 * The modal carries a Cancel button. When the user cancels, the controller
 * fires its AbortSignal so the flow can stop polling.
 */
export interface OAuthProgressController {
  showUserCode(info: { userCode: string; verificationUri: string }): void;
  setStatus(text: string): void;
  finish(): void;
  fail(error: Error | string): void;
  readonly signal: AbortSignal;
}

export class OAuthProgressModal extends DraggableModal {
  private statusEl: HTMLElement | null = null;
  private codeEl: HTMLElement | null = null;
  private linkEl: HTMLElement | null = null;
  private abortController = new AbortController();
  private finished = false;

  constructor(
    app: App,
    private opts: OAuthProgressOptions,
    private start: (controller: OAuthProgressController) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal-content");
    titleEl.setText(this.opts.title);

    contentEl.createDiv({
      cls: "fm-editor-confirm-message",
      text: this.opts.description,
    });

    this.codeEl = contentEl.createDiv({ cls: "fm-editor-oauth-code" });
    this.linkEl = contentEl.createDiv({ cls: "fm-editor-oauth-link" });
    this.statusEl = contentEl.createDiv({
      cls: "fm-editor-modal-status",
    });
    this.statusEl.setText(this.opts.initialStatus ?? "Starting...");

    const footer = contentEl.createDiv({ cls: "fm-editor-modal-footer" });
    const right = footer.createDiv({ cls: "fm-editor-modal-footer-right" });
    const cancel = right.createEl("button", {
      cls: "fm-editor-btn",
      text: "Cancel",
    });
    cancel.addEventListener("click", () => {
      if (!this.finished) {
        this.abortController.abort();
        this.close();
      } else {
        this.close();
      }
    });

    // Kick off the flow
    void this.start({
      showUserCode: (info) => this.showUserCode(info),
      setStatus: (text) => this.statusEl?.setText(text),
      finish: () => {
        this.finished = true;
        this.close();
      },
      fail: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.statusEl?.setText(`Failed: ${message}`);
        new Notice(`OAuth failed: ${message}`);
        this.finished = true;
      },
      signal: this.abortController.signal,
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.statusEl?.setText(`Failed: ${message}`);
    });
  }

  private showUserCode(info: { userCode: string; verificationUri: string }): void {
    if (this.codeEl) {
      this.codeEl.empty();
      this.codeEl.createSpan({
        cls: "fm-editor-oauth-code-label",
        text: "Code:",
      });
      const code = this.codeEl.createEl("code", {
        cls: "fm-editor-oauth-code-value",
        text: info.userCode,
      });
      const copy = this.codeEl.createEl("button", {
        text: "Copy",
        cls: "fm-editor-btn",
      });
      copy.addEventListener("click", () => {
        void navigator.clipboard.writeText(info.userCode);
        new Notice("Code copied.");
      });
      void code; // keep reference for selection
    }
    if (this.linkEl) {
      this.linkEl.empty();
      const open = this.linkEl.createEl("button", {
        cls: "fm-editor-btn mod-cta",
        text: "Open verification page in browser",
      });
      open.addEventListener("click", () => {
        if (!openExternal(info.verificationUri)) {
          new Notice(
            "Could not open browser automatically. Visit the URL manually.",
          );
        }
      });
      this.linkEl.createDiv({
        cls: "fm-editor-modal-hint",
        text: `URL: ${info.verificationUri}`,
      });
    }
  }

  onClose(): void {
    if (!this.finished) this.abortController.abort();
    this.contentEl.empty();
  }
}
