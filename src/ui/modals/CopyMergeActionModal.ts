/**
 * CopyMergeActionModal -- unified Copy + Move + value-mapping modal.
 *
 * Replaces the redundant CopyActionModal and MergeActionModal with one
 * surface that switches between Copy and Move via a Mode toggle, and
 * adds a value-mapping section (per-value rewrite + many-to-one +
 * bulk transforms) inspired by Power Query Replace Values and
 * Tableau Prep group-and-replace.
 *
 * The TransferAction it emits is interpreted in
 * BulkActionService.applyActionPure -- the engine handles transforms
 * + value mapping atomically per note, including wikilink unwrap +
 * re-wrap and many-to-one dedup.
 */

import { Setting, setIcon } from "obsidian";
import type {
  BulkAction,
  NoteRow,
  PropertyStat,
  TransferAction,
} from "../../types";
import { BaseActionModal } from "./BaseActionModal";
import { ValueMappingTable } from "../components/ValueMappingTable";

type Mode = "copy" | "move";
type Conflict = "skip" | "overwrite" | "merge_list";

export class CopyMergeActionModal extends BaseActionModal {
  private mode: Mode = "copy";
  private fromProperties: string[] = [];
  private toProperty = "";
  private onConflict: Conflict = "overwrite";
  private wrapWikilink = false;
  private chipsHostEl: HTMLElement | null = null;
  private mappingHost: HTMLElement | null = null;
  private vmTable: ValueMappingTable | null = null;
  private counterEl: HTMLElement | null = null;
  private mappingSectionEl: HTMLElement | null = null;
  private mappingExpanded = true;

  constructor(
    app: import("obsidian").App,
    plugin: import("../../main").default,
    targets: NoteRow[],
    inventory: PropertyStat[],
    onDone: () => void,
    /** Pre-fill the modal with a single source property (used when
     *  invoked from a column-header context menu). */
    preselectedSource?: string,
    /** Open in Move mode (deleteSource=true) right away. */
    initialMode?: Mode,
  ) {
    super(app, plugin, targets, inventory, onDone);
    if (preselectedSource) this.fromProperties.push(preselectedSource);
    if (initialMode) this.mode = initialMode;
  }

  protected title(): string {
    return this.mode === "copy"
      ? "Copy property values"
      : "Move property values";
  }

  protected buildForm(container: HTMLElement): void {
    container.createDiv({
      cls: "fm-editor-modal-hint",
      text:
        "Copy reads source properties into the target and leaves them in place. Move does the same and removes the source properties afterwards. Use the optional Value mapping section to rewrite or merge values during the transfer.",
    });

    this.buildModeToggle(container);
    this.buildSourcePicker(container);
    this.buildTargetField(container);
    this.buildConflictField(container);
    this.buildWikilinkToggle(container);

    this.mappingSectionEl = container.createDiv({
      cls: "fm-editor-vm-section",
    });
    this.renderMappingSection();

    this.counterEl = container.createDiv({ cls: "fm-editor-modal-status" });
    this.refreshCounter();
  }

  // ---- mode toggle ----

  private buildModeToggle(container: HTMLElement): void {
    new Setting(container)
      .setName("Mode")
      .setDesc(
        "Copy keeps the source properties. Move deletes them after the transfer.",
      )
      .then((setting) => {
        const toggle = setting.controlEl.createDiv({
          cls: "fm-editor-mode-toggle",
        });
        const copyBtn = toggle.createEl("button", { text: "Copy" });
        const moveBtn = toggle.createEl("button", { text: "Move" });
        const sync = () => {
          copyBtn.toggleClass("is-active", this.mode === "copy");
          moveBtn.toggleClass("is-active", this.mode === "move");
          this.titleEl.setText(this.title());
        };
        copyBtn.addEventListener("click", () => {
          this.mode = "copy";
          sync();
        });
        moveBtn.addEventListener("click", () => {
          this.mode = "move";
          sync();
        });
        sync();
      });
  }

  // ---- source picker (chip list, multi-add) ----

  private buildSourcePicker(container: HTMLElement): void {
    const setting = new Setting(container)
      .setName("Source properties")
      .setDesc(
        "One or more properties whose values are transferred into the target. Add the same value twice to merge legacy keys.",
      );
    const control = setting.controlEl;
    control.addClass("fm-editor-multi-source");
    this.chipsHostEl = control.createDiv({
      cls: "fm-editor-multi-source-chips",
    });
    const addWrap = control.createDiv({ cls: "fm-editor-multi-source-add" });
    const addInput = addWrap.createEl("input", {
      type: "text",
      cls: "fm-editor-filter-input",
      attr: { list: "fm-editor-transfer-from-list" },
      placeholder: "Type property name, then Enter",
    });
    this.propertyDatalist(addWrap, "fm-editor-transfer-from-list");
    addInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        this.addFrom(addInput.value);
        addInput.value = "";
      }
    });
    const addBtn = addWrap.createEl("button", { cls: "fm-editor-btn" });
    setIcon(addBtn.createSpan(), "plus");
    addBtn.createSpan({ text: "Add" });
    addBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      this.addFrom(addInput.value);
      addInput.value = "";
      addInput.focus();
    });
    this.renderChips();
  }

  private addFrom(raw: string): void {
    const name = raw.trim();
    if (!name) return;
    if (this.fromProperties.includes(name)) return;
    this.fromProperties.push(name);
    this.renderChips();
    this.renderMappingSection();
    this.refreshCounter();
  }

  private removeFrom(name: string): void {
    this.fromProperties = this.fromProperties.filter((p) => p !== name);
    this.renderChips();
    this.renderMappingSection();
    this.refreshCounter();
  }

  private renderChips(): void {
    const host = this.chipsHostEl;
    if (!host) return;
    host.empty();
    if (this.fromProperties.length === 0) {
      host.createSpan({
        cls: "fm-editor-empty-hint",
        text: "No source properties yet",
      });
      return;
    }
    for (const name of this.fromProperties) {
      const chip = host.createSpan({
        cls: "fm-editor-pill fm-editor-pill-link",
      });
      chip.createSpan({ text: name });
      const x = chip.createEl("button", { cls: "fm-editor-chip-remove" });
      setIcon(x, "x");
      x.title = "Remove source";
      x.addEventListener("click", (ev) => {
        ev.preventDefault();
        this.removeFrom(name);
      });
    }
  }

  // ---- target + conflict + wikilink ----

  private buildTargetField(container: HTMLElement): void {
    new Setting(container)
      .setName("Target property")
      .setDesc("Where the values land.")
      .addText((text) => {
        text
          .setPlaceholder("e.g. category")
          .setValue(this.toProperty)
          .onChange((value) => {
            this.toProperty = value;
            this.refreshCounter();
          });
        text.inputEl.setAttribute("list", "fm-editor-transfer-to-list");
      })
      .then((s) =>
        this.propertyDatalist(s.controlEl, "fm-editor-transfer-to-list"),
      );
  }

  private buildConflictField(container: HTMLElement): void {
    new Setting(container)
      .setName("If target already has a value")
      .setDesc("Behaviour on notes where the target already exists.")
      .addDropdown((d) => {
        d.addOption("skip", "Skip this note (do not transfer)");
        d.addOption("overwrite", "Overwrite target with new value");
        d.addOption("merge_list", "Append into list with existing value");
        d.setValue(this.onConflict);
        d.onChange((value) => {
          this.onConflict = value as Conflict;
        });
      });
  }

  private buildWikilinkToggle(container: HTMLElement): void {
    new Setting(container)
      .setName("Wrap value as wikilink")
      .setDesc("Convert the transferred value to [[wikilink]] if it isn't already.")
      .addToggle((t) => {
        t.setValue(this.wrapWikilink).onChange((v) => {
          this.wrapWikilink = v;
        });
      });
  }

  // ---- value mapping section ----

  private renderMappingSection(): void {
    const root = this.mappingSectionEl;
    if (!root) return;
    root.empty();
    this.vmTable = null;
    this.mappingHost = null;

    const header = root.createDiv({ cls: "fm-editor-vm-header" });
    const left = header.createDiv();
    left.createDiv({
      cls: "fm-editor-vm-header-title",
      text: "Value mapping",
    });
    left.createDiv({
      cls: "fm-editor-vm-header-sub",
      text:
        "Optional. Rewrite source values, merge multiple into one (e.g. Person + Teilnehmer -> person), or apply bulk transforms like lowercase. Untouched rows pass through.",
    });
    const caret = header.createSpan({ cls: "fm-editor-vm-header-toggle" });
    setIcon(caret, this.mappingExpanded ? "chevron-up" : "chevron-down");
    header.addEventListener("click", () => {
      this.mappingExpanded = !this.mappingExpanded;
      this.renderMappingSection();
      this.refreshCounter();
    });

    if (!this.mappingExpanded) return;

    if (this.fromProperties.length === 0) {
      root.createDiv({
        cls: "fm-editor-vm-empty",
        text: "Add at least one source property to load distinct values.",
      });
      return;
    }

    const distinct = this.plugin.scanner.collectDistinctValues(
      this.targets,
      this.fromProperties,
    );
    this.vmTable = new ValueMappingTable(distinct, {
      onChange: () => this.refreshCounter(),
    });
    this.vmTable.mount(root);

    this.mappingHost = root.createDiv({ cls: "fm-editor-vm-preview" });
    this.refreshPreviewBullets();
  }

  private refreshPreviewBullets(): void {
    if (!this.mappingHost || !this.vmTable) return;
    this.mappingHost.empty();
    const groups = this.vmTable.getPreviewGroups();
    if (groups.length === 0) {
      this.mappingHost.setText(
        "No value rewrites configured -- this is a 1:1 transfer.",
      );
      return;
    }
    this.mappingHost.createDiv({ text: "Mappings:" });
    const ul = this.mappingHost.createEl("ul");
    for (const g of groups.slice(0, 5)) {
      const li = ul.createEl("li");
      li.setText(
        `${g.sources.join(", ")} -> ${g.target} (${g.affectedNotes} occurrence${g.affectedNotes === 1 ? "" : "s"})`,
      );
    }
    if (groups.length > 5) {
      ul.createEl("li", { text: `+${groups.length - 5} more mappings` });
    }
  }

  // ---- counters ----

  private refreshCounter(): void {
    if (!this.counterEl) return;
    this.refreshPreviewBullets();
    const built = this.buildAction();
    if ("error" in built) {
      this.counterEl.setText(built.error);
      return;
    }
    // Re-run pure preview to count actual change/skip on real targets.
    const previews = this.plugin.bulk.previewAction(this.targets, built);
    const changed = previews.filter((p) => p.changed).length;
    const skipped = previews.filter((p) => p.skippedReason).length;
    const unchanged = previews.length - changed - skipped;
    this.counterEl.setText(
      `${changed} notes will change, ${unchanged} unchanged, ${skipped} skipped (target exists).`,
    );
  }

  // ---- action assembly ----

  protected buildAction(): BulkAction | { error: string } {
    if (this.fromProperties.length === 0) {
      return { error: "Add at least one source property" };
    }
    const to = this.toProperty.trim();
    if (!to) return { error: "Target property required" };
    const action: TransferAction = {
      type: "transfer",
      fromProperties: [...this.fromProperties],
      toProperty: to,
      deleteSource: this.mode === "move",
      onConflict: this.onConflict,
      wrapWikilink: this.wrapWikilink,
      transforms: this.vmTable?.getTransforms() ?? [],
      valueMappings: this.vmTable?.getMappings() ?? [],
    };
    return action;
  }
}
