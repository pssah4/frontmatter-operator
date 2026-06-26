import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { FrontmatterScanner } from "./services/FrontmatterScanner";
import { SnapshotService } from "./services/SnapshotService";
import { BulkActionService } from "./services/BulkActionService";
import {
  FrontmatterEditorView,
  VIEW_TYPE_FRONTMATTER_EDITOR,
} from "./ui/FrontmatterEditorView";
import { SetActionModal } from "./ui/modals/SetActionModal";
import { DeleteActionModal } from "./ui/modals/DeleteActionModal";
import { RenameActionModal } from "./ui/modals/RenameActionModal";
import { CopyActionModal } from "./ui/modals/CopyActionModal";
import { MergeActionModal } from "./ui/modals/MergeActionModal";
import { SnapshotsModal } from "./ui/modals/SnapshotsModal";
import { FrontmatterEditorAPI } from "./api/FrontmatterEditorAPI";

export default class FrontmatterEditorPlugin extends Plugin {
  scanner!: FrontmatterScanner;
  snapshots!: SnapshotService;
  bulk!: BulkActionService;
  api!: FrontmatterEditorAPI;

  async onload(): Promise<void> {
    this.scanner = new FrontmatterScanner(this.app);
    this.snapshots = new SnapshotService(this.app);
    this.bulk = new BulkActionService(this.app, this.snapshots);
    this.api = new FrontmatterEditorAPI(
      this.app,
      this.scanner,
      this.bulk,
      this.snapshots,
    );

    this.registerView(
      VIEW_TYPE_FRONTMATTER_EDITOR,
      (leaf) => new FrontmatterEditorView(leaf, this),
    );

    this.addRibbonIcon("table", "Open Frontmatter Editor", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-frontmatter-editor",
      name: "Open Frontmatter Editor",
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: "set-property",
      name: "Set frontmatter property on filtered notes...",
      callback: () => {
        void this.openActionModal("set");
      },
    });

    this.addCommand({
      id: "delete-properties",
      name: "Delete frontmatter properties on filtered notes...",
      callback: () => {
        void this.openActionModal("delete");
      },
    });

    this.addCommand({
      id: "rename-property",
      name: "Rename frontmatter property on filtered notes...",
      callback: () => {
        void this.openActionModal("rename");
      },
    });

    this.addCommand({
      id: "copy-property",
      name: "Copy frontmatter property on filtered notes...",
      callback: () => {
        void this.openActionModal("copy");
      },
    });

    this.addCommand({
      id: "merge-properties",
      name: "Merge frontmatter properties on filtered notes...",
      callback: () => {
        void this.openActionModal("merge");
      },
    });

    this.addCommand({
      id: "undo-last",
      name: "Undo last frontmatter action",
      callback: async () => {
        const result = await this.api.undoLast();
        if (!result) {
          new Notice("No snapshot to undo.");
        } else {
          new Notice(
            `Undo: ${result.successCount} restored, ${result.errorCount} errors`,
          );
        }
      },
    });

    this.addCommand({
      id: "open-snapshots",
      name: "Open snapshot history",
      callback: () => {
        new SnapshotsModal(this.app, this, () => {
          /* no-op */
        }).open();
      },
    });

    this.addCommand({
      id: "list-properties",
      name: "Print frontmatter property inventory to console",
      callback: () => {
        const props = this.scanner.scan().properties;
        console.debug("[frontmatter-editor] property inventory:", props);
        new Notice(
          `${props.length} unique properties — see developer console for full inventory.`,
        );
      },
    });
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_FRONTMATTER_EDITOR);
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(
      VIEW_TYPE_FRONTMATTER_EDITOR,
    );
    let leaf: WorkspaceLeaf | null;
    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: VIEW_TYPE_FRONTMATTER_EDITOR,
        active: true,
      });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  private async openActionModal(
    kind: "set" | "delete" | "rename" | "copy" | "merge",
  ): Promise<void> {
    await this.activateView();
    const scan = this.scanner.scan();
    const rows = this.scanner.buildAllRows();
    const refresh = () => {
      /* view re-render is handled on next open */
    };
    switch (kind) {
      case "set":
        new SetActionModal(this.app, this, rows, scan.properties, refresh).open();
        break;
      case "delete":
        new DeleteActionModal(
          this.app,
          this,
          rows,
          scan.properties,
          refresh,
        ).open();
        break;
      case "rename":
        new RenameActionModal(
          this.app,
          this,
          rows,
          scan.properties,
          refresh,
        ).open();
        break;
      case "copy":
        new CopyActionModal(this.app, this, rows, scan.properties, refresh).open();
        break;
      case "merge":
        new MergeActionModal(
          this.app,
          this,
          rows,
          scan.properties,
          refresh,
        ).open();
        break;
    }
  }
}
