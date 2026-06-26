import { App, Modal, Notice, setIcon } from "obsidian";
import type FrontmatterEditorPlugin from "../../main";
import type { Snapshot } from "../../types";

export class SnapshotsModal extends Modal {
  constructor(
    app: App,
    private plugin: FrontmatterEditorPlugin,
    private onChange: () => void,
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal-content");
    titleEl.setText("Snapshots");

    contentEl.createDiv({
      cls: "fm-editor-modal-hint",
      text: "Every bulk action writes a JSON snapshot under .frontmatter-editor/snapshots/. Restore reverts the affected notes to their previous frontmatter. The 50 most recent snapshots are kept.",
    });

    const list = contentEl.createDiv({ cls: "fm-editor-snapshot-list" });
    const snaps = await this.plugin.snapshots.list();
    if (snaps.length === 0) {
      list.createDiv({
        cls: "fm-editor-empty-hint",
        text: "No snapshots yet — run an action to record the first one.",
      });
      return;
    }
    for (const snap of snaps) {
      this.renderSnapshot(list, snap);
    }
  }

  private renderSnapshot(parent: HTMLElement, snap: Snapshot): void {
    const row = parent.createDiv({ cls: "fm-editor-snapshot-row" });
    const head = row.createDiv({ cls: "fm-editor-snapshot-head" });
    head.createSpan({
      text: snap.id,
      cls: "fm-editor-snapshot-id",
    });
    head.createSpan({
      text: `${describeAction(snap.action)} · ${snap.entries.length} ${snap.entries.length === 1 ? "note" : "notes"}`,
      cls: "fm-editor-snapshot-action",
    });

    const actions = row.createDiv({ cls: "fm-editor-snapshot-actions" });

    const restoreBtn = actions.createEl("button", {
      cls: "fm-editor-btn mod-cta",
    });
    setIcon(restoreBtn.createSpan(), "undo-2");
    restoreBtn.createSpan({ text: "Restore" });
    restoreBtn.addEventListener("click", async () => {
      if (
        !confirm(
          `Restore ${snap.entries.length} note(s) to the state before "${describeAction(snap.action)}"?`,
        )
      )
        return;
      const result = await this.plugin.bulk.restoreSnapshot(snap);
      new Notice(
        `Restore: ${result.successCount} restored, ${result.errorCount} errors`,
      );
      this.onChange();
      this.close();
    });

    const delBtn = actions.createEl("button", {
      cls: "fm-editor-icon-btn mod-warning",
    });
    setIcon(delBtn, "trash-2");
    delBtn.title = "Delete this snapshot";
    delBtn.addEventListener("click", async () => {
      if (!confirm("Delete this snapshot?")) return;
      await this.plugin.snapshots.delete(snap.id);
      new Notice("Snapshot deleted");
      row.remove();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function describeAction(action: Snapshot["action"]): string {
  switch (action.type) {
    case "set":
      return `set ${action.property} = ${JSON.stringify(action.value)}`;
    case "delete":
      return `delete ${action.property}`;
    case "rename":
    case "copy":
    case "move": {
      const legacy = (action as { fromProperty?: string }).fromProperty;
      const sources = action.fromProperties
        ? action.fromProperties.join(" + ")
        : (legacy ?? "?");
      return `${action.type} ${sources} → ${action.toProperty}`;
    }
  }
}
