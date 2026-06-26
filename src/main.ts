import { Plugin, WorkspaceLeaf } from "obsidian";
import { FrontmatterScanner } from "./services/FrontmatterScanner";
import { SnapshotService } from "./services/SnapshotService";
import { BulkActionService } from "./services/BulkActionService";
import {
  FrontmatterEditorView,
  VIEW_TYPE_FRONTMATTER_EDITOR,
} from "./ui/FrontmatterEditorView";

export default class FrontmatterEditorPlugin extends Plugin {
  scanner!: FrontmatterScanner;
  snapshots!: SnapshotService;
  bulk!: BulkActionService;

  async onload(): Promise<void> {
    this.scanner = new FrontmatterScanner(this.app);
    this.snapshots = new SnapshotService(this.app);
    this.bulk = new BulkActionService(this.app, this.snapshots);

    this.registerView(
      VIEW_TYPE_FRONTMATTER_EDITOR,
      (leaf) => new FrontmatterEditorView(leaf, this),
    );

    this.addRibbonIcon("list-tree", "Open Frontmatter Editor", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-frontmatter-editor",
      name: "Open Frontmatter Editor",
      callback: () => {
        void this.activateView();
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
}
