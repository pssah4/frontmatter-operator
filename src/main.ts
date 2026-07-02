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
import { RenameValuesActionModal } from "./ui/modals/RenameValuesActionModal";
import { SnapshotsModal } from "./ui/modals/SnapshotsModal";
import { confirmModal } from "./ui/modals/ConfirmModal";
import { FrontmatterEditorAPI } from "./api/FrontmatterEditorAPI";
import { GeneratorService } from "./services/generator/GeneratorService";
import {
  DEFAULT_SETTINGS,
  type FrontmatterEditorSettings,
} from "./types/settings";
import { FrontmatterEditorSettingsTab } from "./ui/settings/SettingsTab";
import {
  DEFAULT_PRESETS,
  fillMissingLanguagePrompts,
  migrateLegacyCustomPrompt,
} from "./types/generators";
import { SafeStorageService } from "./auth/SafeStorageService";
import {
  assertNoPlaintextSecrets,
  decryptSettingsAfterLoad,
  encryptSettingsForSave,
} from "./auth/encryptSettings";
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
    // H-1: SafeStorage must exist BEFORE loadSettings so the decrypt
    // step has its keychain handle. Construction is sync and has no
    // dependencies, so safe to do before loadData.
    this.safeStorage = new SafeStorageService();
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

    this.copilotAuth = new GitHubCopilotAuthService(this);
    this.chatgptAuth = new ChatGptOAuthService(this);
    this.kiloAuth = new KiloAuthService(this);

    this.generator = new GeneratorService(this.app, this);

    this.addSettingTab(new FrontmatterEditorSettingsTab(this.app, this));

    this.registerView(
      VIEW_TYPE_FRONTMATTER_EDITOR,
      (leaf) => new FrontmatterEditorView(leaf, this),
    );

    this.addRibbonIcon("copy-slash", "Open frontmatter operator", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open",
      name: "Open editor view",
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
      id: "rename-values",
      name: "Rename frontmatter values on filtered notes...",
      callback: () => {
        void this.openActionModal("rename-values");
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
      id: "cleanup-refusal-tags",
      name: "Clean refusal text from tags across the vault",
      callback: () => {
        void this.runRefusalCleanup();
      },
    });

    this.addCommand({
      id: "dedupe-wikilinks",
      name: "Deduplicate wikilinks across the vault",
      callback: () => {
        void this.runWikilinkDedup();
      },
    });

    this.addCommand({
      id: "list-properties",
      name: "Print frontmatter property inventory to console",
      callback: () => {
        const props = this.scanner.scan().properties;
        console.debug("[frontmatter-operator] property inventory:", props);
        new Notice(
          `${props.length} unique properties. See developer console for full inventory.`,
        );
      },
    });
  }

  /**
   * Two-phase refusal-tag cleanup (also reachable from the Settings
   * Maintenance section). Phase 1 runs a dry-run scan, shows the
   * user how many notes would change. Phase 2 only fires after the
   * user confirms; takes a single snapshot so the whole batch is
   * undoable via the existing snapshot machinery.
   */
  async runRefusalCleanup(): Promise<void> {
    const { RefusalTagCleanupService } = await import(
      "./services/RefusalTagCleanupService"
    );
    const service = new RefusalTagCleanupService(this.app, this.snapshots);
    // Scan EVERY frontmatter property (not just `tags`). The user's
    // 476-note leak from the previous run was in part not in `tags`
    // at all -- the v1 cleanup defaulted to that one key and reported
    // "nothing to clean". v2 scans all keys.
    const dry = await service.run({ dryRun: true });
    if (dry.notesTouched === 0) {
      new Notice(
        `Refusal-tag cleanup: scanned ${dry.notesScanned} notes, nothing to clean across any frontmatter property.`,
        8000,
      );
      // Diagnostic: dump the structure of the first few notes that
      // have ANY frontmatter so the user can see what we're actually
      // looking at. Helps when the user expected hits but got none.
      console.debug(
        "[frontmatter-operator] cleanup dry-run report:",
        dry,
      );
      return;
    }
    const propsAffected = Object.entries(dry.propertiesAffected)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} (${n})`)
      .join(", ");
    const ok = await confirmModal(this.app, {
      title: "Clean refusal text from frontmatter across the vault?",
      message:
        `Notes affected: ${dry.notesTouched} of ${dry.notesScanned}. ` +
        `Items removed: ${dry.itemsRemoved}. Properties: ${propsAffected}. ` +
        `A snapshot is saved so the cleanup can be undone from the ` +
        `undo-last-frontmatter-action command.`,
      confirmLabel: "Clean",
      destructive: true,
    });
    if (!ok) return;
    const real = await service.run({ dryRun: false });
    new Notice(
      `Cleanup done: ${real.notesTouched}/${real.notesScanned} notes, ` +
        `${real.itemsRemoved} items removed. Undo via "Undo last frontmatter action".`,
      10_000,
    );
    console.debug(
      "[frontmatter-operator] cleanup write report:",
      real,
    );
  }

  /**
   * Two-phase wikilink dedup (also reachable from the Settings
   * Maintenance section and, with `paths`, from the table's selection
   * action bar). Collapses frontmatter wikilinks that resolve to the
   * same note and shortens lone path-form links to Obsidian's canonical
   * form. Dry-run scan -> confirm -> snapshotted real run.
   */
  async runWikilinkDedup(opts: { paths?: string[] } = {}): Promise<void> {
    const { WikilinkDedupCleanupService } = await import(
      "./services/WikilinkDedupCleanupService"
    );
    const service = new WikilinkDedupCleanupService(this.app, this.snapshots);
    const scopeLabel = opts.paths
      ? `${opts.paths.length} selected note${opts.paths.length === 1 ? "" : "s"}`
      : "the vault";
    const dry = await service.run({ dryRun: true, paths: opts.paths });
    if (dry.notesTouched === 0) {
      new Notice(
        `Wikilink dedup: scanned ${dry.notesScanned} notes in ${scopeLabel}, no duplicate or path-form links to clean.`,
        8000,
      );
      return;
    }
    const propsAffected = Object.entries(dry.propertiesAffected)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} (${n})`)
      .join(", ");
    const ok = await confirmModal(this.app, {
      title: `Deduplicate wikilinks in ${scopeLabel}?`,
      message:
        `Notes affected: ${dry.notesTouched} of ${dry.notesScanned}. ` +
        `Duplicates removed: ${dry.duplicatesRemoved}. ` +
        `Links shortened: ${dry.linksRewritten}. Properties: ${propsAffected}. ` +
        `A snapshot is saved so the change can be undone from the ` +
        `undo-last-frontmatter-action command.`,
      confirmLabel: "Deduplicate",
      destructive: true,
    });
    if (!ok) return;
    const real = await service.run({ dryRun: false, paths: opts.paths });
    const errSuffix =
      real.errors.length > 0 ? `, ${real.errors.length} errors` : "";
    new Notice(
      `Wikilink dedup done: ${real.notesTouched}/${real.notesScanned} notes, ` +
        `${real.duplicatesRemoved} duplicates removed, ${real.linksRewritten} links shortened${errSuffix}. ` +
        `Undo via "Undo last frontmatter action".`,
      10_000,
    );
    console.debug("[frontmatter-operator] wikilink dedup report:", real);
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
      // Custom prompts: migrate legacy {systemPrompt,userPrompt} pairs
      // to the new single-string shape so saved templates from before
      // this version still work. Lossy by design -- the systemPrompt
      // was always a copy of the guardrail which now lives in code.
      customPrompts: (stored?.customPrompts as unknown[] | undefined ?? [])
        .map((c) => migrateLegacyCustomPrompt(c))
        .filter((c): c is NonNullable<typeof c> => c !== null),
    };
    // H-1 (AUDIT 2026-06-29): decrypt every long-lived secret that
    // was encrypted by a previous save. Plaintext values from before
    // this fix shipped pass through unchanged and get re-encrypted
    // on the next saveSettings -- one-shot, no explicit migration.
    decryptSettingsAfterLoad(this.settings, this.safeStorage);
    // Drop the legacy `models` array if it's still in data.json -- the new
    // schema is provider-centric and incompatible with the old per-model
    // entity. Users re-add via "+ Add provider".
    if (stored && "models" in stored) {
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    // H-1: encrypt every secret field before the settings hit disk.
    // The encrypt helper deep-clones first so in-memory state stays
    // plaintext (every consumer accesses tokens/keys via
    // this.settings.* and would crash if it got an "enc:v1:..."
    // value). If safeStorage is unavailable (mobile / no keychain),
    // SafeStorageService emits a Notice and returns the plaintext
    // unchanged -- documented degradation, not a silent failure.
    const onDisk = encryptSettingsForSave(this.settings, this.safeStorage);
    if (this.safeStorage.isAvailable()) {
      // Defence-in-depth: assert no plaintext slipped through any
      // future newly-added secret field. In production this just
      // logs a warning; tests promote it to a hard failure.
      const offenders = assertNoPlaintextSecrets(onDisk);
      if (offenders.length > 0) {
        console.warn(
          "frontmatter-operator: plaintext secret fields detected on save:",
          offenders,
        );
      }
    }
    await this.saveData(onDisk);
  }

  private mergePresets(stored?: typeof DEFAULT_PRESETS): typeof DEFAULT_PRESETS {
    // Keep built-in presets in sync with code; preserve user prompt
    // edits per language; fill missing languages from the canonical
    // defaults so the 11-language expansion doesn't break old saves
    // that only had en+de.
    if (!stored || stored.length === 0)
      return JSON.parse(
        JSON.stringify(DEFAULT_PRESETS),
      ) as typeof DEFAULT_PRESETS;
    const byId = new Map(stored.map((p) => [p.id, p]));
    const merged = DEFAULT_PRESETS.map((d) => {
      const existing = byId.get(d.id);
      if (!existing) return JSON.parse(JSON.stringify(d)) as typeof d;
      return fillMissingLanguagePrompts({
        ...d,
        prompts: { ...d.prompts, ...(existing.prompts ?? {}) },
      });
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
    await this.app.workspace.revealLeaf(leaf);
  }

  private async openActionModal(
    kind: "set" | "delete" | "rename" | "rename-values" | "copy" | "merge",
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
      case "rename-values":
        new RenameValuesActionModal(
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
