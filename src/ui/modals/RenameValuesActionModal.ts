/**
 * RenameValuesActionModal -- batch-rename the VALUES of a single property.
 *
 * Sibling of CopyMergeActionModal but focused on one property and rewriting
 * its values in place (keys stay). Reuses the same ValueMappingTable
 * (per-value rewrite + bulk transforms) and emits a MapValuesAction, which
 * BulkActionService applies via mapFmValue and only writes to notes whose
 * value actually changes.
 */

import { Setting, setIcon } from "obsidian";
import type {
  BulkAction,
  MapValuesAction,
  NoteRow,
  PropertyStat,
} from "../../types";
import { BaseActionModal } from "./BaseActionModal";
import { ValueMappingTable } from "../components/ValueMappingTable";

export class RenameValuesActionModal extends BaseActionModal {
  private property: string;
  private vmTable: ValueMappingTable | null = null;
  private mappingSectionEl: HTMLElement | null = null;
  private counterEl: HTMLElement | null = null;
  private mappingExpanded = true;

  constructor(
    app: import("obsidian").App,
    plugin: import("../../main").default,
    targets: NoteRow[],
    inventory: PropertyStat[],
    onDone: () => void,
    /** Pre-fill the property (used when invoked from a column header). */
    preselectedProperty?: string,
  ) {
    super(app, plugin, targets, inventory, onDone);
    this.property = preselectedProperty ?? "";
  }

  protected title(): string {
    return "Rename values";
  }

  protected buildForm(container: HTMLElement): void {
    container.createDiv({
      cls: "fm-editor-modal-hint",
      text:
        'Rewrite the VALUES of one property across the targeted notes (e.g. rename "Interview" to "interview"). Keys stay; only notes whose value actually changes are touched. Use the per-value table or the bulk transforms (lowercase, trim, ...).',
    });

    this.buildPropertyField(container);

    this.mappingSectionEl = container.createDiv({ cls: "fm-editor-vm-section" });
    this.renderMappingSection();

    this.counterEl = container.createDiv({ cls: "fm-editor-modal-status" });
    this.refreshCounter();
  }

  private buildPropertyField(container: HTMLElement): void {
    new Setting(container)
      .setName("Property")
      .setDesc("The property whose values you want to rename.")
      .addText((text) => {
        text
          .setPlaceholder("Example: type")
          .setValue(this.property)
          .onChange((value) => {
            this.property = value;
            this.renderMappingSection();
            this.refreshCounter();
          });
        text.inputEl.setAttribute("list", "fm-editor-rename-values-prop-list");
      })
      .then((s) =>
        this.propertyDatalist(s.controlEl, "fm-editor-rename-values-prop-list"),
      );
  }

  private renderMappingSection(): void {
    const root = this.mappingSectionEl;
    if (!root) return;
    root.empty();
    this.vmTable = null;

    const header = root.createDiv({ cls: "fm-editor-vm-header" });
    const left = header.createDiv();
    left.createDiv({ cls: "fm-editor-vm-header-title", text: "Value mapping" });
    left.createDiv({
      cls: "fm-editor-vm-header-sub",
      text:
        "Edit a target to rename that value; leave a target empty to drop it. Bulk-transform chips apply to every untouched row.",
    });
    const caret = header.createSpan({ cls: "fm-editor-vm-header-toggle" });
    setIcon(caret, this.mappingExpanded ? "chevron-up" : "chevron-down");
    header.addEventListener("click", () => {
      this.mappingExpanded = !this.mappingExpanded;
      this.renderMappingSection();
      this.refreshCounter();
    });

    if (!this.mappingExpanded) return;

    const prop = this.property.trim();
    if (!prop) {
      root.createDiv({
        cls: "fm-editor-vm-empty",
        text: "Pick a property to load its distinct values.",
      });
      return;
    }

    const distinct = this.plugin.scanner.collectDistinctValues(this.targets, [
      prop,
    ]);
    if (distinct.length === 0) {
      root.createDiv({
        cls: "fm-editor-vm-empty",
        text: `No values found for "${prop}" on the targeted notes.`,
      });
      return;
    }
    this.vmTable = new ValueMappingTable(distinct, {
      onChange: () => this.refreshCounter(),
    });
    this.vmTable.mount(root);
  }

  private refreshCounter(): void {
    if (!this.counterEl) return;
    const built = this.buildAction();
    if ("error" in built) {
      this.counterEl.setText(built.error);
      return;
    }
    const previews = this.plugin.bulk.previewAction(this.targets, built);
    const changed = previews.filter((p) => p.changed).length;
    const skipped = previews.filter((p) => p.skippedReason).length;
    const unchanged = previews.length - changed - skipped;
    this.counterEl.setText(
      `${changed} notes will change, ${unchanged} unchanged, ${skipped} skipped.`,
    );
  }

  protected buildAction(): BulkAction | { error: string } {
    const prop = this.property.trim();
    if (!prop) return { error: "Pick a property" };
    const transforms = this.vmTable?.getTransforms() ?? [];
    const valueMappings = this.vmTable?.getMappings() ?? [];
    if (transforms.length === 0 && valueMappings.length === 0) {
      return { error: "Add at least one value rewrite or a transform" };
    }
    const action: MapValuesAction = {
      type: "map_values",
      property: prop,
      transforms,
      valueMappings,
    };
    return action;
  }
}
