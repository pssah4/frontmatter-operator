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
import { CopyMergeActionModal } from "./ui/modals/CopyMergeActionModal";
import { SnapshotsModal } from "./ui/modals/SnapshotsModal";
import { FrontmatterEditorAPI } from "./api/FrontmatterEditorAPI";
import { GeneratorService } from "./services/generator/GeneratorService";
import {
  DEFAULT_SETTINGS,
  type FrontmatterEditorSettings,
} from "./types/settings";
import { FrontmatterEditorSettingsTab } from "./ui/settings/SettingsTab";
import { DEFAULT_PRESETS } from "./types/generators";
import { SafeStorageService } from "./auth/SafeStorageService";
import { GitHubCopilotAuthService } from "./auth/GitHubCopilotAuthService";
import { ChatGptOAuthService } from "./auth/ChatGptOAuthService";
import { KiloAuthService } from "./auth/KiloAuthService";

export default class FrontmatterEditorPlugin extends Plugin {
  scanner!: FrontmatterScanner;
  snapshots!: SnapshotService;
  bulk!: BulkActionService;
  api!: FrontmatterEditorAPI;
  generator!: GeneratorService;
  declare settings: FrontmatterEditorSettings;
  safeStorage!: SafeStorageService;
  copilotAuth!: GitHubCopilotAuthService;
  chatgptAuth!: ChatGptOAuthService;
  kiloAuth!: KiloAuthService;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.scanner = new FrontmatterScanner(this.app);
    this.snapshots = new SnapshotService(this.app);
    this.bulk = new BulkActionService(this.app, this.snapshots);
    this.api = new FrontmatterEditorAPI(
      this.app,
      this.scanner,
      this.bulk,
      this.snapshots,
    );

    this.safeStorage = new SafeStorageService();
    this.copilotAuth = new GitHubCopilotAuthService(this);
    this.chatgptAuth = new ChatGptOAuthService(this);
    this.kiloAuth = new KiloAuthService(this);

    this.generator = new GeneratorService(this.app, this);

    this.addSettingTab(new FrontmatterEditorSettingsTab(this.app, this));

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

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as
      | (Partial<FrontmatterEditorSettings> & {
          models?: unknown[];
        })
      | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(stored ?? {}),
      providers: stored?.providers ?? [],
      lastUsedModelByProvider: stored?.lastUsedModelByProvider ?? {},
      presets: this.mergePresets(stored?.presets),
      customPrompts: stored?.customPrompts ?? [],
    };
    // Drop the legacy `models` array if it's still in data.json -- the new
    // schema is provider-centric and incompatible with the old per-model
    // entity. Users re-add via "+ Add provider".
    if (stored && "models" in stored) {
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private mergePresets(stored?: typeof DEFAULT_PRESETS): typeof DEFAULT_PRESETS {
    // Keep built-in presets in sync with code; preserve user prompt edits.
    if (!stored || stored.length === 0) return JSON.parse(JSON.stringify(DEFAULT_PRESETS));
    const byId = new Map(stored.map((p) => [p.id, p]));
    const merged = DEFAULT_PRESETS.map((d) => {
      const existing = byId.get(d.id);
      if (!existing) return JSON.parse(JSON.stringify(d));
      // existing wins for prompts; missing language fallback to default
      return {
        ...d,
        prompts: {
          en: existing.prompts?.en ?? d.prompts.en,
          de: existing.prompts?.de ?? d.prompts.de,
        },
      };
    });
    return merged;
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
        // Legacy command id -- opens the unified transfer modal in Copy
        // (deleteSource=false) mode, with the value-mapping section
        // available.
        new CopyMergeActionModal(
          this.app,
          this,
          rows,
          scan.properties,
          refresh,
          undefined,
          "copy",
        ).open();
        break;
      case "merge":
        // Legacy command id -- opens the unified transfer modal in Move
        // (deleteSource=true) mode. "Merge" was always implemented as
        // a Move with a >= 2 source guard; that guard is dropped here.
        new CopyMergeActionModal(
          this.app,
          this,
          rows,
          scan.properties,
          refresh,
          undefined,
          "move",
        ).open();
        break;
    }
  }
}
