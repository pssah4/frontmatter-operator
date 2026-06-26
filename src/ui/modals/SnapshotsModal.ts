import { App, Modal, Notice } from "obsidian";
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
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal");
    contentEl.createEl("h2", { text: "Snapshots" });
    contentEl.createDiv({
      cls: "fm-editor-empty-hint",
      text: "Each bulk action writes a JSON snapshot to .frontmatter-editor/snapshots/. Restore reverts the affected notes to their previous frontmatter.",
    });

    const list = contentEl.createDiv({ cls: "fm-editor-snapshot-list" });
    const snaps = await this.plugin.snapshots.list();
    if (snaps.length === 0) {
      list.createDiv({
        cls: "fm-editor-empty-hint",
        text: "No snapshots yet.",
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
      text: `${snap.id}  --  ${snap.entries.length} notes`,
      cls: "fm-editor-snapshot-id",
    });
    head.createSpan({
      text: ` (${describeAction(snap.action)})`,
      cls: "fm-editor-snapshot-action",
    });

    const actions = row.createDiv({ cls: "fm-editor-snapshot-actions" });

    const restoreBtn = actions.createEl("button", {
      text: "Restore",
      cls: "fm-editor-btn fm-editor-btn-primary",
    });
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
      text: "Delete",
      cls: "fm-editor-btn",
    });
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
      return `set ${action.property} = ${JSON.stringify(action.value)} (${action.mode})`;
    case "delete":
      return `delete ${action.property}`;
    case "rename":
    case "copy":
    case "move": {
      const legacy = (action as { fromProperty?: string }).fromProperty;
      const sources = action.fromProperties
        ? action.fromProperties.join(" + ")
        : (legacy ?? "?");
      return `${action.type} ${sources} -> ${action.toProperty} (${action.onConflict})`;
    }
  }
}
