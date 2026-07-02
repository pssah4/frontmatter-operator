import { App, Notice, setIcon } from "obsidian";
import { DraggableModal } from "./DraggableModal";
import type FrontmatterEditorPlugin from "../../main";
import type { Snapshot } from "../../types";
import { confirmModal } from "./ConfirmModal";

export class SnapshotsModal extends DraggableModal {
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
      text: "Every bulk action writes a JSON snapshot under the plugin data folder (plugins/frontmatter-operator/snapshots/). Restore reverts the affected notes to their previous frontmatter. The 50 most recent snapshots are kept.",
    });

    const list = contentEl.createDiv({ cls: "fm-editor-snapshot-list" });
    const snaps = await this.plugin.snapshots.list();
    if (snaps.length === 0) {
      list.createDiv({
        cls: "fm-editor-empty-hint",
        text: "No snapshots yet. Run an action to record the first one.",
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
    restoreBtn.addEventListener("click", () => {
      void this.handleRestore(snap);
    });

    const delBtn = actions.createEl("button", {
      cls: "fm-editor-icon-btn mod-warning",
    });
    setIcon(delBtn, "trash-2");
    delBtn.title = "Delete this snapshot";
    delBtn.addEventListener("click", () => {
      void this.handleDelete(snap, row);
    });
  }

  private async handleRestore(snap: Snapshot): Promise<void> {
    const proceed = await confirmModal(this.app, {
      title: "Restore snapshot?",
      message: `Restore ${snap.entries.length} note${snap.entries.length === 1 ? "" : "s"} to the state before "${describeAction(snap.action)}".`,
      confirmLabel: "Restore",
      cancelLabel: "Cancel",
    });
    if (!proceed) return;
    const result = await this.plugin.bulk.restoreSnapshot(snap);
    new Notice(
      `Restore: ${result.successCount} restored, ${result.errorCount} errors`,
    );
    this.onChange();
    this.close();
  }

  private async handleDelete(snap: Snapshot, row: HTMLElement): Promise<void> {
    const proceed = await confirmModal(this.app, {
      title: "Delete snapshot?",
      message: "This removes the snapshot file. You won't be able to restore from it.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!proceed) return;
    await this.plugin.snapshots.delete(snap.id);
    new Notice("Snapshot deleted");
    row.remove();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function describeAction(action: Snapshot["action"]): string {
  switch (action.type) {
    case "set":
      return `set ${action.property} = ${JSON.stringify(action.value)}`;
    case "delete": {
      const legacy = (action as { property?: string }).property;
      const list = action.properties
        ? action.properties.join(", ")
        : (legacy ?? "?");
      return `delete ${list}`;
    }
    case "rename":
    case "copy":
    case "move": {
      const legacy = (action as { fromProperty?: string }).fromProperty;
      const sources = action.fromProperties
        ? action.fromProperties.join(" + ")
        : (legacy ?? "?");
      const verb = action.type === "move" ? "merge" : action.type;
      return `${verb} ${sources} -> ${action.toProperty}`;
    }
    case "transfer": {
      const sources = action.fromProperties.join(" + ");
      const verb = action.deleteSource ? "move" : "copy";
      const mapCount = action.valueMappings.length;
      const transformCount = action.transforms.length;
      const extras = [
        transformCount > 0 ? `${transformCount} transform${transformCount === 1 ? "" : "s"}` : null,
        mapCount > 0 ? `${mapCount} value mapping${mapCount === 1 ? "" : "s"}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `${verb} ${sources} -> ${action.toProperty}${extras ? ` (${extras})` : ""}`;
    }
    case "map_values": {
      const mapCount = action.valueMappings.length;
      const transformCount = action.transforms.length;
      const extras = [
        transformCount > 0
          ? `${transformCount} transform${transformCount === 1 ? "" : "s"}`
          : null,
        mapCount > 0
          ? `${mapCount} value mapping${mapCount === 1 ? "" : "s"}`
          : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `rename values of ${action.property}${extras ? ` (${extras})` : ""}`;
    }
  }
}
