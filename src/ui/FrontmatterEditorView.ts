import {
  ItemView,
  Notice,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import type FrontmatterEditorPlugin from "../main";
import type {
  Filter,
  FilterCombinator,
  FilterOperator,
  FmValue,
  NoteRow,
  PropertyStat,
} from "../types";
import { FILTER_OPERATORS } from "../types";
import { applyFilters, evaluateFilter } from "../services/FilterEngine";
import { SetActionModal } from "./modals/SetActionModal";
import { DeleteActionModal } from "./modals/DeleteActionModal";
import { RenameActionModal } from "./modals/RenameActionModal";
import { CopyMergeActionModal } from "./modals/CopyMergeActionModal";
import { SnapshotsModal } from "./modals/SnapshotsModal";
import { HelpModal } from "./modals/HelpModal";
import { confirmModal } from "./modals/ConfirmModal";
import { GenerateActionModal } from "./modals/GenerateActionModal";
import { Combobox } from "./components/Combobox";
import { renderEditableCell } from "./components/EditableCell";
import { waitForMetadataChange } from "../services/generator/GeneratorService";
import { VirtualProperties } from "../services/VirtualProperties";
import {
  MultiSelectPopover,
  type MultiOption,
} from "./components/MultiSelectPopover";

export const VIEW_TYPE_FRONTMATTER_EDITOR = "frontmatter-editor-view";

const MAX_VISIBLE_ROWS = 500;
const DEFAULT_COLUMN_COUNT = 4;

interface ColumnState {
  property: string;
  sort: "asc" | "desc" | null;
  filter: Filter | null;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export class FrontmatterEditorView extends ItemView {
  private globalFilters: Filter[] = [];
  private combinator: FilterCombinator = "AND";
  private inventory: PropertyStat[] = [];
  private allRows: NoteRow[] = [];
  private filteredRows: NoteRow[] = [];
  private selectedPaths = new Set<string>();
  private columns: ColumnState[] = [];
  private dragSourceIndex: number | null = null;
  private openFilterPopoverFor: string | null = null;
  private activeMultiSelectPopover: MultiSelectPopover | null = null;
  private notePathFilter = "";

  private actionHintEl: HTMLElement | null = null;
  private tableBodyEl: HTMLElement | null = null;
  private resultsCountEl: HTMLElement | null = null;
  private ruleSummaryEl: HTMLElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: FrontmatterEditorPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_FRONTMATTER_EDITOR;
  }

  getDisplayText(): string {
    return "Frontmatter Editor";
  }

  getIcon(): string {
    return "table";
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass("fm-editor-root");
    await this.refreshScan();
    this.render();
  }

  async onClose(): Promise<void> {
    this.containerEl.removeClass("fm-editor-root");
  }

  async refreshScan(): Promise<void> {
    const scan = this.plugin.scanner.scan();
    this.allRows = this.plugin.scanner.buildAllRows();
    // Virtuals (Folder / Filename / Extension) sit at the top of the
    // inventory so they're easy to pick in the column + WHEN-bar
    // pickers. They're keyed by __-prefixed ids that won't collide
    // with real frontmatter keys.
    this.inventory = [
      ...VirtualProperties.asInventoryEntries(this.allRows.length),
      ...scan.properties,
    ];
    if (this.columns.length === 0) {
      this.columns = this.suggestColumns();
    } else {
      // Keep virtual columns even when no frontmatter entry matches --
      // their value lives on the file, not in the frontmatter, so the
      // "is the property still present anywhere" check doesn't apply.
      this.columns = this.columns.filter(
        (c) =>
          VirtualProperties.isVirtual(c.property) ||
          this.inventory.some((p) => p.name === c.property),
      );
    }
    this.recomputeFilteredRows();
  }

  /**
   * Read the value for a column on a given row, honouring virtual
   * properties. Used by sort + per-column filter + cell render so
   * none of those paths need to know about the __-prefix convention.
   */
  private readCol(row: NoteRow, property: string): FmValue | undefined {
    return VirtualProperties.isVirtual(property)
      ? VirtualProperties.resolve(property, row)
      : row.frontmatter[property];
  }

  private suggestColumns(): ColumnState[] {
    return this.inventory
      .slice(0, DEFAULT_COLUMN_COUNT)
      .map((p) => ({ property: p.name, sort: null, filter: null }));
  }

  private activeColumnFilters(): Filter[] {
    return this.columns
      .map((c) => c.filter)
      .filter((f): f is Filter => !!f);
  }

  private allActiveConditions(): Filter[] {
    const conditions: Filter[] = [...this.globalFilters];
    for (const f of this.activeColumnFilters()) {
      conditions.push(f);
    }
    return conditions;
  }

  private recomputeFilteredRows(): void {
    let rows = applyFilters(this.allRows, this.globalFilters, this.combinator);
    const perCol = this.activeColumnFilters();
    if (perCol.length > 0) {
      rows = rows.filter((row) =>
        perCol.every((f) => evaluateFilter(f, row)),
      );
    }
    const pathNeedle = this.notePathFilter.trim().toLowerCase();
    if (pathNeedle) {
      rows = rows.filter(
        (row) =>
          row.path.toLowerCase().includes(pathNeedle) ||
          row.basename.toLowerCase().includes(pathNeedle),
      );
    }

    const sortCols = this.columns.filter((c) => c.sort !== null);
    if (sortCols.length > 0) {
      rows = rows.slice().sort((a, b) => {
        for (const col of sortCols) {
          const cmp = compareValues(
            this.readCol(a, col.property),
            this.readCol(b, col.property),
          );
          if (cmp !== 0) return col.sort === "asc" ? cmp : -cmp;
        }
        return a.path.localeCompare(b.path);
      });
    }

    this.filteredRows = rows;
    this.selectedPaths = new Set(
      Array.from(this.selectedPaths).filter((p) =>
        this.filteredRows.some((r) => r.path === p),
      ),
    );
  }

  private render(): void {
    if (this.activeMultiSelectPopover) {
      this.activeMultiSelectPopover.close();
      this.activeMultiSelectPopover = null;
    }
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("fm-editor-content");

    this.renderToolbar(root);
    this.renderWhenBar(root);
    this.renderTableSection(root);
    this.renderActionBar(root);
  }

  private scrollToSelector(selector: string): void {
    const root = this.containerEl.children[1] as HTMLElement;
    const el = root.querySelector(selector) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // ============================================================ TOOLBAR

  private renderToolbar(root: HTMLElement): void {
    const header = root.createDiv({ cls: "fm-editor-header" });

    const left = header.createDiv({ cls: "fm-editor-header-left" });
    left.createSpan({
      text: "Frontmatter Editor",
      cls: "fm-editor-title-text",
    });
    const withFm = this.allRows.filter(
      (r) => Object.keys(r.frontmatter).length > 0,
    ).length;
    left.createSpan({
      text: `${this.allRows.length} notes · ${withFm} w/ frontmatter · ${this.inventory.length} properties`,
      cls: "fm-editor-subtitle",
    });

    const right = header.createDiv({ cls: "fm-editor-header-right" });

    this.makeIconButton(
      right,
      "list-tree",
      "Properties — pick visible columns",
      (btn) => this.openPropertyPicker(btn),
    );

    this.appendDivider(right);

    this.makeIconButton(right, "settings", "Plugin settings", () => {
      this.openPluginSettings();
    });
    this.makeIconButton(right, "rotate-cw", "Refresh", async () => {
      await this.refreshScan();
      this.render();
    });
    this.makeIconButton(right, "undo-2", "Undo last action", async () => {
      await this.undoLastAction();
    });
    this.makeIconButton(right, "history", "Snapshot history", () => {
      new SnapshotsModal(this.app, this.plugin, () => {
        void this.refreshScan().then(() => this.render());
      }).open();
    });

    this.appendDivider(right);

    this.makeIconButton(right, "help-circle", "How to use", () => {
      new HelpModal(this.app).open();
    });
  }

  private appendDivider(parent: HTMLElement): void {
    parent.createDiv({ cls: "fm-editor-header-divider" });
  }

  private makeIconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: (btn: HTMLButtonElement) => void | Promise<void>,
  ): HTMLButtonElement {
    const btn = parent.createEl("button", { cls: "fm-editor-icon-btn" });
    setIcon(btn, icon);
    btn.setAttribute("aria-label", label);
    btn.title = label;
    btn.addEventListener("click", () => {
      void onClick(btn);
    });
    return btn;
  }

  private openPluginSettings(): void {
    const setting = (this.app as unknown as {
      setting?: {
        open: () => void;
        openTabById: (id: string) => void;
      };
    }).setting;
    if (!setting) {
      new Notice("Settings panel not available.");
      return;
    }
    setting.open();
    setting.openTabById(this.plugin.manifest.id);
  }

  private async undoLastAction(): Promise<void> {
    const snaps = await this.plugin.snapshots.list();
    if (snaps.length === 0) {
      new Notice("No snapshot to undo.");
      return;
    }
    const latest = snaps[0];
    const proceed = await confirmModal(this.app, {
      title: "Undo last action?",
      message: `Restore ${latest.entries.length} note${latest.entries.length === 1 ? "" : "s"} from snapshot ${latest.id}.`,
      confirmLabel: "Restore",
      cancelLabel: "Cancel",
    });
    if (!proceed) return;
    const result = await this.plugin.bulk.restoreSnapshot(latest);
    new Notice(
      `Undo: ${result.successCount} restored, ${result.errorCount} errors`,
    );
    await this.refreshScan();
    this.render();
  }

  // ============================================================ PROPERTY PICKER

  private openPropertyPicker(anchor: HTMLElement): void {
    if (this.activeMultiSelectPopover) {
      this.activeMultiSelectPopover.close();
      this.activeMultiSelectPopover = null;
      return;
    }
    // Virtual properties (folder / filename / extension) get a
    // friendly label + a "Note metadata" hint so they're
    // distinguishable from real frontmatter keys in the picker.
    const options: MultiOption[] = this.inventory.map((p) => {
      const vp = VirtualProperties.get(p.name);
      if (vp) {
        return {
          value: vp.id,
          label: vp.label,
          hint: "Note metadata",
          meta: "",
        };
      }
      return {
        value: p.name,
        label: p.name,
        hint: Array.from(p.types).join(" / "),
        meta: String(p.count),
      };
    });
    const selected = new Set(this.columns.map((c) => c.property));
    const popover = new MultiSelectPopover({
      options,
      selected,
      placeholder: "Search properties...",
      onToggle: (value, isSelected) => {
        const idx = this.columns.findIndex((c) => c.property === value);
        if (isSelected && idx === -1) {
          this.columns.push({ property: value, sort: null, filter: null });
        } else if (!isSelected && idx >= 0) {
          this.columns.splice(idx, 1);
        }
        this.recomputeFilteredRows();
        this.render();
      },
      onClose: () => {
        this.activeMultiSelectPopover = null;
      },
    });
    popover.attach(anchor);
    this.activeMultiSelectPopover = popover;
  }

  // ============================================================ WHEN BAR

  /**
   * Re-render JUST the WHEN bar without throwing away the table or the
   * action bar. Used by the per-row checkbox handler so a tick
   * immediately materialises (or removes) the selection chip in the
   * WHEN bar -- without that, the chip only appeared on the next full
   * render() and felt like a separate surface.
   */
  private refreshWhenBar(): void {
    const old = this.containerEl.querySelector(".fm-editor-when-section");
    if (!old) return;
    const parent = old.parentElement;
    if (!parent) return;
    // Build the new section into a detached fragment first so we can
    // swap atomically and preserve sibling order (the rule summary,
    // table, action bar must stay below the WHEN section).
    const host = document.createElement("div");
    this.renderWhenBar(host as unknown as HTMLElement);
    const fresh = host.firstElementChild;
    if (fresh) parent.insertBefore(fresh, old);
    old.remove();
  }

  private renderWhenBar(parent: HTMLElement): void {
    const section = parent.createDiv({ cls: "fm-editor-section fm-editor-when-section" });
    const head = section.createDiv({ cls: "fm-editor-section-head" });

    const labelBlock = head.createDiv({ cls: "fm-editor-section-label-block" });
    labelBlock.createSpan({
      text: "WHEN",
      cls: "fm-editor-section-label",
    });
    labelBlock.createSpan({
      text: "filter the notes to act on",
      cls: "fm-editor-section-sublabel",
    });

    this.ruleSummaryEl = head.createDiv({ cls: "fm-editor-rule-summary" });
    this.updateRuleSummary();

    const actions = head.createDiv({ cls: "fm-editor-section-actions" });

    const addBtn = actions.createEl("button", {
      cls: "fm-editor-add-condition",
    });
    const addIcon = addBtn.createSpan({ cls: "fm-editor-menu-icon" });
    setIcon(addIcon, "plus");
    addBtn.createSpan({ text: "Add condition" });
    addBtn.addEventListener("click", () => {
      this.globalFilters.push({
        id: uid(),
        property: this.inventory[0]?.name ?? "",
        operator: "exists",
      });
      this.recomputeFilteredRows();
      this.render();
    });

    if (this.globalFilters.length > 0 || this.activeColumnFilters().length > 0 || this.notePathFilter) {
      this.makeIconButton(actions, "filter-x", "Clear all conditions", () => {
        this.globalFilters = [];
        for (const c of this.columns) c.filter = null;
        this.notePathFilter = "";
        this.recomputeFilteredRows();
        this.render();
      });
    }

    const bar = section.createDiv({ cls: "fm-editor-filter-bar" });
    const list = bar.createDiv({ cls: "fm-editor-conditions" });
    if (this.globalFilters.length === 0 && this.selectedPaths.size === 0) {
      const hint = list.createDiv({ cls: "fm-editor-condition-empty" });
      hint.setText(
        "No global conditions yet — that's fine. You can also (only) use the per-column filter row in the table below, or leave everything empty to match every note in the vault.",
      );
    } else {
      this.globalFilters.forEach((f, idx) => {
        this.renderConditionRow(list, f, idx);
      });
      if (this.selectedPaths.size > 0) {
        this.renderNoteSelectionChip(list, this.globalFilters.length);
      }
    }
  }

  /**
   * Pseudo-condition that mirrors the table tick-boxes. Shows up in the WHEN
   * bar as "Note in [a, b, c]" while at least one row is ticked; clicking the
   * remove button clears the selection (which also collapses the chip).
   */
  /**
   * Render the ticked-rows chip in the WHEN bar so it visually matches
   * every other condition row -- same `fm-editor-condition` container
   * class, same chip-prop/chip-op/chip-val cells the regular condition
   * uses, same combinator slot. The user reads "selected notes" as
   * just another WHEN constraint, not a separate "Where" thing.
   *
   * The chip is read-only: the user controls it by ticking checkboxes
   * in the table, not by editing dropdowns. The clear-icon (X) drops
   * the selection and re-renders the whole view.
   */
  private renderNoteSelectionChip(parent: HTMLElement, index: number): void {
    // Use the same base class as renderConditionRow so styles.css gives
    // both the same border, padding, background, hover. No -derived
    // modifier -- the chip IS a normal WHEN condition.
    const row = parent.createDiv({ cls: "fm-editor-condition" });

    row.createSpan({
      text: index === 0 ? "WHERE" : "AND",
      cls: "fm-editor-condition-combinator",
    });

    // Property cell -- match the chip-prop-wrap shell so it gets the
    // same chip styling as the property Combobox in regular rows.
    const propWrap = row.createDiv({ cls: "fm-editor-chip-prop-wrap" });
    const propChip = propWrap.createSpan({ cls: "fm-editor-chip" });
    setIcon(propChip.createSpan({ cls: "fm-editor-chip-icon" }), "file-text");
    propChip.createSpan({
      cls: "fm-editor-chip-label",
      text: "Note",
    });

    // Operator cell -- styled as the regular operator <select> would
    // be (matches .fm-editor-condition-op).
    const opEl = row.createEl("span", {
      cls: "fm-editor-condition-op fm-editor-condition-op-static",
    });
    opEl.setText(this.selectedPaths.size === 1 ? "equals" : "in");

    // Value cell -- count + preview, title attribute carries the full
    // list for hover. Same chip-val class the rule summary uses so
    // user gets the same monospace value style.
    const paths = Array.from(this.selectedPaths);
    const preview = paths
      .slice(0, 3)
      .map((p) => p.split("/").pop()!.replace(/\.md$/, ""))
      .join(", ");
    const more = paths.length > 3 ? `, +${paths.length - 3}` : "";
    const valWrap = row.createDiv({ cls: "fm-editor-chip-val-wrap" });
    const valChip = valWrap.createSpan({ cls: "fm-editor-chip" });
    valChip.createSpan({
      cls: "fm-editor-chip-count",
      text: `${paths.length}`,
    });
    const valText = valChip.createSpan({
      cls: "fm-editor-chip-label",
      text: paths.length === 1 ? preview : `${preview}${more}`,
    });
    valText.title = paths.join("\n");

    // Action cell -- mirror renderConditionRow's actions div so the
    // X-button lands in the same spot as a regular condition's remove.
    const actions = row.createDiv({ cls: "fm-editor-condition-actions" });
    const remove = this.makeIconButton(
      actions,
      "x",
      "Clear note selection",
      () => {
        this.selectedPaths.clear();
        this.recomputeFilteredRows();
        this.render();
      },
    );
    remove.addClass("mod-warning");
  }

  private renderConditionRow(
    parent: HTMLElement,
    filter: Filter,
    index: number,
  ): void {
    const row = parent.createDiv({ cls: "fm-editor-condition" });

    if (index === 0) {
      row.createSpan({
        text: "WHERE",
        cls: "fm-editor-condition-combinator",
      });
    } else {
      const sel = row.createEl("select", {
        cls: "fm-editor-condition-combinator-select",
      });
      for (const c of ["AND", "OR"] as const) {
        const opt = sel.createEl("option", { value: c, text: c });
        if (c === this.combinator) opt.selected = true;
      }
      sel.addEventListener("change", () => {
        this.combinator = sel.value as FilterCombinator;
        this.recomputeFilteredRows();
        this.render();
      });
    }

    const propWrap = row.createDiv({ cls: "fm-editor-chip-prop-wrap" });
    const propCombo = new Combobox({
      placeholder: "Property",
      allowFreeform: true,
      maxResults: 100,
      onChange: (value) => {
        filter.property = value;
        if (filter.value !== undefined) filter.value = "";
        this.recomputeFilteredRows();
        this.render();
      },
    });
    propCombo.mount(propWrap, filter.property);
    propCombo.setOptions(
      this.inventory.map((p) => {
        const vp = VirtualProperties.get(p.name);
        if (vp) {
          return {
            value: vp.id,
            label: vp.label,
            hint: "Note metadata",
            meta: "",
          };
        }
        return {
          value: p.name,
          label: p.name,
          hint: Array.from(p.types).join(" / "),
          meta: String(p.count),
        };
      }),
    );

    const opSelect = row.createEl("select", { cls: "fm-editor-chip-op" });
    for (const op of FILTER_OPERATORS) {
      const o = opSelect.createEl("option", { value: op, text: humanOp(op) });
      if (op === filter.operator) o.selected = true;
    }
    opSelect.addEventListener("change", () => {
      filter.operator = opSelect.value as FilterOperator;
      this.recomputeFilteredRows();
      this.render();
    });

    if (operatorNeedsValue(filter.operator)) {
      const valWrap = row.createDiv({ cls: "fm-editor-chip-value-wrap" });
      const valCombo = new Combobox({
        placeholder: "value",
        allowFreeform: true,
        maxResults: 60,
        emptyMessage: "Type to use as custom value",
        onChange: (value) => {
          filter.value = value;
          this.recomputeFilteredRows();
          this.render();
        },
      });
      valCombo.mount(valWrap, filter.value ?? "");
      const values = this.plugin.scanner.getPropertyValues(
        this.allRows,
        filter.property,
        80,
      );
      valCombo.setOptions(
        values.map((v) => ({
          value: v.value,
          label: v.value,
          meta: String(v.count),
        })),
      );
    }

    const csLabel = row.createEl("label", { cls: "fm-editor-checkbox-line" });
    csLabel.title = "Case sensitive";
    const csInput = csLabel.createEl("input", { type: "checkbox" });
    csInput.checked = !!filter.caseSensitive;
    csLabel.createSpan({ text: "Aa" });
    csInput.addEventListener("change", () => {
      filter.caseSensitive = csInput.checked;
      this.recomputeFilteredRows();
      this.render();
    });

    const matchCount = this.countMatchesForFilter(filter);
    const badge = row.createSpan({ cls: "fm-editor-condition-badge" });
    setIcon(badge, "file-text");
    badge.createSpan({ text: ` ${matchCount}` });
    badge.title = `${matchCount} notes match this condition on its own`;

    const actions = row.createDiv({ cls: "fm-editor-condition-actions" });
    const remove = this.makeIconButton(actions, "x", "Remove condition", () => {
      this.globalFilters = this.globalFilters.filter((x) => x.id !== filter.id);
      this.recomputeFilteredRows();
      this.render();
    });
    remove.addClass("mod-warning");
  }

  private countMatchesForFilter(filter: Filter): number {
    if (!filter.property) return 0;
    if (
      operatorNeedsValue(filter.operator) &&
      (!filter.value || filter.value.length === 0)
    ) {
      return 0;
    }
    let count = 0;
    for (const row of this.allRows) {
      if (evaluateFilter(filter, row)) count++;
    }
    return count;
  }

  private updateRuleSummary(): void {
    if (!this.ruleSummaryEl) return;
    this.ruleSummaryEl.empty();
    const all = this.allActiveConditions();
    if (this.notePathFilter) {
      all.unshift({
        id: "_path",
        property: "(note path)",
        operator: "in_path",
        value: this.notePathFilter,
      });
    }
    if (this.selectedPaths.size > 0) {
      const sample = Array.from(this.selectedPaths)
        .slice(0, 2)
        .map((p) => p.split("/").pop()!.replace(/\.md$/, ""))
        .join(", ");
      const suffix = this.selectedPaths.size > 2 ? `, +${this.selectedPaths.size - 2}` : "";
      all.push({
        id: "_selection",
        property: "Note",
        operator: this.selectedPaths.size === 1 ? "equals" : "in_path",
        value: sample + suffix,
      });
    }
    if (all.length === 0) {
      this.ruleSummaryEl.createSpan({
        cls: "fm-editor-rule-summary-empty",
        text: "no conditions — rule matches every note",
      });
      return;
    }
    all.forEach((f, idx) => {
      if (idx > 0) {
        this.ruleSummaryEl!.createSpan({
          cls: "fm-editor-rule-summary-combinator",
          text: ` ${this.combinator} `,
        });
      }
      this.ruleSummaryEl!.createSpan({
        cls: "fm-editor-rule-summary-prop",
        text: f.property,
      });
      this.ruleSummaryEl!.createSpan({
        cls: "fm-editor-rule-summary-op",
        text: humanOp(f.operator),
      });
      if (f.value) {
        this.ruleSummaryEl!.createSpan({
          cls: "fm-editor-rule-summary-val",
          text: `"${f.value}"`,
        });
      }
    });
  }

  // ============================================================ TABLE

  private renderTableSection(parent: HTMLElement): void {
    const section = parent.createDiv({ cls: "fm-editor-table-section" });

    const toolbar = section.createDiv({ cls: "fm-editor-table-toolbar" });
    this.resultsCountEl = toolbar.createSpan({
      cls: "fm-editor-table-status",
    });
    this.updateResultsCount();

    const allSelected =
      this.filteredRows.length > 0 &&
      this.filteredRows.every((r) => this.selectedPaths.has(r.path));
    const selBtn = toolbar.createEl("button", {
      cls: "fm-editor-btn",
      text: allSelected ? "Deselect all" : "Select all matched",
    });
    setIcon(selBtn.createSpan(), allSelected ? "square" : "check-square");
    selBtn.addEventListener("click", () => {
      if (allSelected) {
        this.selectedPaths.clear();
      } else {
        for (const r of this.filteredRows) this.selectedPaths.add(r.path);
      }
      this.render();
    });

    const tableWrap = section.createDiv({ cls: "fm-editor-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "fm-editor-table" });
    const thead = table.createEl("thead");

    const headRow = thead.createEl("tr", { cls: "fm-editor-head-row" });
    headRow.createEl("th", { text: "", cls: "fm-editor-col-check" });

    const noteTh = headRow.createEl("th", { cls: "fm-editor-col-note-head" });
    const noteInner = noteTh.createDiv({ cls: "fm-editor-col-head-inner" });
    noteInner.createSpan({
      cls: "fm-editor-col-head-name",
      text: "Note",
    });

    this.columns.forEach((col, index) => {
      this.renderColumnHeader(headRow, col, index);
    });

    const addTh = headRow.createEl("th", { cls: "fm-editor-col-add" });
    const addBtn = addTh.createEl("button", {
      cls: "fm-editor-col-add-btn",
      text: "+",
    });
    addBtn.title = "Add property column";
    addBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.openPropertyPicker(addBtn);
    });

    this.renderFilterRow(thead);

    const tbody = table.createEl("tbody");
    this.tableBodyEl = tbody;
    this.renderTableBodyOnly();

    if (this.filteredRows.length > MAX_VISIBLE_ROWS) {
      section.createDiv({
        cls: "fm-editor-truncated-hint",
        text: `Showing first ${MAX_VISIBLE_ROWS} of ${this.filteredRows.length} matched notes. Actions still run on all matched notes.`,
      });
    }
  }

  private renderFilterRow(thead: HTMLElement): void {
    const tr = thead.createEl("tr", { cls: "fm-editor-filter-row" });
    tr.createEl("td", { cls: "fm-editor-col-check" });

    const noteTd = tr.createEl("td");
    this.renderNoteFilterInput(noteTd);

    for (const col of this.columns) {
      const td = tr.createEl("td");
      this.renderColumnFilterInput(td, col);
    }

    tr.createEl("td", { cls: "fm-editor-col-add" });
  }

  private renderNoteFilterInput(parent: HTMLElement): void {
    const input = parent.createEl("input", {
      type: "text",
      cls: "fm-editor-filter-input",
      placeholder: "Filter path or basename...",
    });
    input.value = this.notePathFilter;
    input.addEventListener("input", () => {
      this.notePathFilter = input.value;
      this.recomputeFilteredRows();
      this.renderTableBodyOnly();
      this.updateResultsCount();
      this.updateActionBarHint();
      this.updateRuleSummary();
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        this.notePathFilter = "";
        input.value = "";
        this.recomputeFilteredRows();
        this.renderTableBodyOnly();
        this.updateResultsCount();
        this.updateActionBarHint();
        this.updateRuleSummary();
        input.blur();
      }
    });
  }

  private renderColumnFilterInput(parent: HTMLElement, col: ColumnState): void {
    const isAdvanced =
      col.filter !== null &&
      col.filter.operator !== "contains";

    if (isAdvanced && col.filter) {
      const chip = parent.createDiv({ cls: "fm-editor-filter-advanced" });
      const label = chip.createSpan({
        cls: "fm-editor-filter-advanced-label",
      });
      label.setText(
        `${humanOp(col.filter.operator)}${
          col.filter.value ? ` ${col.filter.value}` : ""
        }`,
      );
      label.title = "Advanced filter — click the column caret to edit";
      const clearBtn = chip.createEl("button", {
        cls: "fm-editor-filter-clear",
      });
      setIcon(clearBtn, "x");
      clearBtn.title = "Clear filter";
      clearBtn.addEventListener("click", () => {
        col.filter = null;
        this.recomputeFilteredRows();
        this.render();
      });
      return;
    }

    const input = parent.createEl("input", {
      type: "text",
      cls: "fm-editor-filter-input",
      placeholder: "Filter...",
    });
    input.value = col.filter?.value ?? "";
    input.addEventListener("input", () => {
      const v = input.value;
      if (v.length === 0) {
        col.filter = null;
      } else {
        col.filter = {
          id: uid(),
          property: col.property,
          operator: "contains",
          value: v,
          caseSensitive: false,
        };
      }
      this.recomputeFilteredRows();
      this.renderTableBodyOnly();
      this.updateResultsCount();
      this.updateActionBarHint();
      this.updateHeaderFilterIndicators();
      this.updateRuleSummary();
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        col.filter = null;
        input.value = "";
        this.recomputeFilteredRows();
        this.renderTableBodyOnly();
        this.updateResultsCount();
        this.updateActionBarHint();
        this.updateHeaderFilterIndicators();
        this.updateRuleSummary();
        input.blur();
      }
    });
  }

  private renderTableBodyOnly(): void {
    const tbody = this.tableBodyEl;
    if (!tbody) return;
    tbody.empty();

    const shown = this.filteredRows.slice(0, MAX_VISIBLE_ROWS);
    for (const row of shown) {
      const tr = tbody.createEl("tr");
      if (this.selectedPaths.has(row.path)) tr.addClass("is-selected");

      const checkTd = tr.createEl("td", { cls: "fm-editor-col-check" });
      const cb = checkTd.createEl("input", { type: "checkbox" });
      cb.checked = this.selectedPaths.has(row.path);
      cb.addEventListener("change", () => {
        if (cb.checked) {
          this.selectedPaths.add(row.path);
          tr.addClass("is-selected");
        } else {
          this.selectedPaths.delete(row.path);
          tr.removeClass("is-selected");
        }
        this.updateActionBarHint();
        // Selection IS a WHEN condition -- when the user ticks even
        // one box, redraw the WHEN bar so the chip appears (or
        // disappears on the last untick) in the same row as the
        // global filters. Previously only the bottom action-bar
        // updated, which made the selection feel like a separate
        // surface rather than another WHEN constraint.
        this.refreshWhenBar();
        this.updateRuleSummary();
      });

      const noteTd = tr.createEl("td", { cls: "fm-editor-col-note" });
      const link = noteTd.createEl("a", {
        text: row.basename,
        cls: "fm-editor-note-link",
      });
      link.title = row.path;
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        void this.app.workspace.openLinkText(
          row.path,
          "",
          ev.metaKey || ev.ctrlKey,
        );
      });

      for (const col of this.columns) {
        const td = tr.createEl("td", { cls: "fm-editor-col-val" });
        const isV = VirtualProperties.isVirtual(col.property);
        renderEditableCell(td, this.readCol(row, col.property), {
          openLink: (linkText) => {
            void this.app.workspace.openLinkText(linkText, row.path, false);
          },
          onSave: isV
            ? undefined
            : async (next) => {
                await this.writeNoteProperty(row.path, col.property, next);
              },
          readOnly: isV,
        });
      }
      tr.createEl("td", { cls: "fm-editor-col-add" });
    }
  }

  /**
   * Write a single frontmatter property on a single note via the
   * Obsidian-native processFrontMatter pipeline. Mirrors the
   * generator's "wait for metadata-cache change before refreshing"
   * pattern so the table redraws with the new value rather than the
   * stale pre-write snapshot. `undefined` deletes the property.
   */
  private async writeNoteProperty(
    path: string,
    property: string,
    next: FmValue | undefined,
  ): Promise<void> {
    // Virtual properties resolve from the file path; v1 doesn't let
    // the user "edit" them. Defence in depth -- the cell renderer
    // already suppresses click-to-edit for virtuals.
    if (VirtualProperties.isVirtual(property)) return;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Note not found: ${path}`);
      return;
    }
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        if (next === undefined) {
          delete fm[property];
        } else {
          fm[property] = next;
        }
      });
      await waitForMetadataChange(this.app, file);
      // Patch the in-memory row so the table redraw picks up the new
      // value the moment we re-render. Without this the
      // recomputeFilteredRows below would re-derive from the cache
      // which is now correct anyway, but updating allRows keeps
      // sorting + per-column filter results consistent.
      const row = this.allRows.find((r) => r.path === path);
      if (row) {
        if (next === undefined) delete row.frontmatter[property];
        else row.frontmatter[property] = next;
      }
      this.recomputeFilteredRows();
      this.renderTableBodyOnly();
      this.updateRuleSummary();
    } catch (err) {
      new Notice(
        `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private updateResultsCount(): void {
    if (!this.resultsCountEl) return;
    this.resultsCountEl.empty();
    this.resultsCountEl.createSpan({
      cls: "fm-editor-table-status-count",
      text: `${this.filteredRows.length} ${this.filteredRows.length === 1 ? "note" : "notes"} matched`,
    });
    const conds = this.allActiveConditions().length;
    if (conds > 0 || this.notePathFilter) {
      this.resultsCountEl.appendText(
        ` from ${conds + (this.notePathFilter ? 1 : 0)} ${
          conds + (this.notePathFilter ? 1 : 0) === 1 ? "condition" : "conditions"
        }`,
      );
    } else {
      this.resultsCountEl.appendText(" — no conditions active");
    }
  }

  private updateHeaderFilterIndicators(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    const headers = root.querySelectorAll(".fm-editor-col-head");
    headers.forEach((th, idx) => {
      const col = this.columns[idx];
      if (!col) return;
      th.toggleClass("fm-editor-col-filtered", !!col.filter);
      const existingDot = th.querySelector(".fm-editor-col-filter-dot");
      if (col.filter && !existingDot) {
        const label = th.querySelector(".fm-editor-col-head-label");
        if (label) {
          const dot = document.createElement("span");
          dot.className = "fm-editor-col-filter-dot";
          setIcon(dot, "dot");
          dot.title = "Filter active";
          label.appendChild(dot);
        }
      } else if (!col.filter && existingDot) {
        existingDot.remove();
      }
    });
  }

  // ============================================================ COLUMN HEADERS

  private renderColumnHeader(
    headRow: HTMLElement,
    col: ColumnState,
    index: number,
  ): void {
    const th = headRow.createEl("th", { cls: "fm-editor-col-head" });
    th.dataset.colIndex = String(index);
    th.setAttr("draggable", "true");

    if (col.sort !== null) th.addClass("fm-editor-col-sorted");
    if (col.filter) th.addClass("fm-editor-col-filtered");

    th.addEventListener("dragstart", (ev) => {
      this.dragSourceIndex = index;
      ev.dataTransfer?.setData("text/plain", String(index));
      th.addClass("fm-editor-col-dragging");
    });
    th.addEventListener("dragend", () => {
      th.removeClass("fm-editor-col-dragging");
      this.dragSourceIndex = null;
    });
    th.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
      th.addClass("fm-editor-col-drop-target");
    });
    th.addEventListener("dragleave", () => {
      th.removeClass("fm-editor-col-drop-target");
    });
    th.addEventListener("drop", (ev) => {
      ev.preventDefault();
      th.removeClass("fm-editor-col-drop-target");
      const src = this.dragSourceIndex;
      if (src === null || src === index) return;
      const moved = this.columns.splice(src, 1)[0];
      this.columns.splice(index, 0, moved);
      this.dragSourceIndex = null;
      this.recomputeFilteredRows();
      this.render();
    });

    const inner = th.createDiv({ cls: "fm-editor-col-head-inner" });

    const nameWrap = inner.createDiv({ cls: "fm-editor-col-head-label" });
    nameWrap.title = "Click to cycle sort · drag to reorder";
    nameWrap.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.cycleSort(col);
    });

    // Virtual columns get a small icon + their friendly label so the
    // header doesn't show the raw "__folder" id. Real properties keep
    // their key as the label.
    const vp = VirtualProperties.get(col.property);
    if (vp) {
      const iconSpan = nameWrap.createSpan({
        cls: "fm-editor-col-head-icon",
      });
      setIcon(iconSpan, vp.icon);
      nameWrap.createSpan({
        text: vp.label,
        cls: "fm-editor-col-head-name fm-editor-col-head-name-virtual",
      });
    } else {
      nameWrap.createSpan({
        text: col.property,
        cls: "fm-editor-col-head-name",
      });
    }
    if (col.sort === "asc") {
      const ind = nameWrap.createSpan({ cls: "fm-editor-col-sort-ind" });
      setIcon(ind, "arrow-up");
    } else if (col.sort === "desc") {
      const ind = nameWrap.createSpan({ cls: "fm-editor-col-sort-ind" });
      setIcon(ind, "arrow-down");
    }
    if (col.filter) {
      const dot = nameWrap.createSpan({
        cls: "fm-editor-col-filter-dot",
      });
      setIcon(dot, "dot");
      dot.title = "Filter active";
    }

    const caret = inner.createEl("button", { cls: "fm-editor-col-caret" });
    setIcon(caret, "chevron-down");
    caret.title = "Column options";
    caret.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.openColumnMenu(th, col, index);
    });

    th.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      this.openColumnMenu(th, col, index);
    });

    if (this.openFilterPopoverFor === col.property) {
      this.renderColumnFilterPopover(th, col);
    }
  }

  private openColumnMenu(
    anchor: HTMLElement,
    col: ColumnState,
    index: number,
  ): void {
    this.containerEl
      .querySelectorAll(".fm-editor-col-menu")
      .forEach((e) => e.remove());

    const menu = anchor.createDiv({ cls: "fm-editor-col-menu" });
    menu.addEventListener("click", (ev) => ev.stopPropagation());

    this.menuItem(menu, "arrow-up", "Sort ascending", col.sort === "asc", () => {
      col.sort = col.sort === "asc" ? null : "asc";
      this.recomputeFilteredRows();
      this.render();
    });
    this.menuItem(menu, "arrow-down", "Sort descending", col.sort === "desc", () => {
      col.sort = col.sort === "desc" ? null : "desc";
      this.recomputeFilteredRows();
      this.render();
    });
    if (col.sort !== null) {
      this.menuItem(menu, "x", "Clear sort", false, () => {
        col.sort = null;
        this.recomputeFilteredRows();
        this.render();
      });
    }

    this.menuDivider(menu);
    this.menuItem(
      menu,
      "filter",
      col.filter ? "Edit column filter..." : "Filter this column...",
      !!col.filter,
      () => {
        this.openFilterPopoverFor = col.property;
        this.render();
      },
    );
    if (col.filter) {
      this.menuItem(menu, "filter-x", "Clear column filter", false, () => {
        col.filter = null;
        this.recomputeFilteredRows();
        this.render();
      });
    }

    this.menuDivider(menu);
    this.menuItem(menu, "eye-off", "Hide column from view", false, () => {
      this.columns.splice(index, 1);
      this.recomputeFilteredRows();
      this.render();
    });

    const targetCount = this.getTargetRows().length;

    this.menuItem(
      menu,
      "sparkles",
      `Generate with AI for "${col.property}"...`,
      false,
      () => {
        this.openGenerateModalForProperty(col.property);
      },
    );

    this.menuDivider(menu);

    const delItem = this.menuItem(
      menu,
      "trash-2",
      `Delete property "${col.property}" from ${targetCount} matched notes...`,
      false,
      () => {
        this.openDeleteForProperty(col.property);
      },
    );
    delItem.addClass("fm-editor-menu-item-danger");

    const closeOnOutside = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        document.removeEventListener("mousedown", closeOnOutside);
        document.removeEventListener("keydown", closeOnEsc);
      }
    };
    const closeOnEsc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        menu.remove();
        document.removeEventListener("mousedown", closeOnOutside);
        document.removeEventListener("keydown", closeOnEsc);
      }
    };
    window.setTimeout(() => {
      document.addEventListener("mousedown", closeOnOutside);
      document.addEventListener("keydown", closeOnEsc);
    }, 0);
  }

  private menuItem(
    parent: HTMLElement,
    icon: string,
    label: string,
    active: boolean,
    onClick: () => void,
  ): HTMLElement {
    const item = parent.createDiv({ cls: "fm-editor-menu-item" });
    if (active) item.addClass("fm-editor-menu-item-active");
    const check = item.createSpan({ cls: "fm-editor-menu-check" });
    if (active) setIcon(check, "check");
    const ic = item.createSpan({ cls: "fm-editor-menu-icon" });
    setIcon(ic, icon);
    item.createSpan({ cls: "fm-editor-menu-label", text: label });
    item.addEventListener("click", () => {
      parent.remove();
      onClick();
    });
    return item;
  }

  private menuDivider(parent: HTMLElement): void {
    parent.createDiv({ cls: "fm-editor-menu-divider" });
  }

  private renderColumnFilterPopover(parent: HTMLElement, col: ColumnState): void {
    const pop = parent.createDiv({ cls: "fm-editor-col-popover" });
    pop.addEventListener("click", (ev) => ev.stopPropagation());

    const filter: Filter = col.filter ?? {
      id: uid(),
      property: col.property,
      operator: "exists",
    };

    const opRow = pop.createDiv({ cls: "fm-editor-popover-row" });
    opRow.createEl("label", { text: "Operator" });
    const opSel = opRow.createEl("select");
    for (const op of FILTER_OPERATORS) {
      const o = opSel.createEl("option", { value: op, text: humanOp(op) });
      if (op === filter.operator) o.selected = true;
    }
    opSel.addEventListener("change", () => {
      filter.operator = opSel.value as FilterOperator;
      filter.property = col.property;
      col.filter = filter;
      this.recomputeFilteredRows();
      this.render();
    });

    if (operatorNeedsValue(filter.operator)) {
      const valRow = pop.createDiv({ cls: "fm-editor-popover-row" });
      valRow.createEl("label", { text: "Value" });
      const valWrap = valRow.createDiv({ cls: "fm-editor-popover-input-wrap" });
      const valCombo = new Combobox({
        placeholder: "value",
        allowFreeform: true,
        maxResults: 60,
        onChange: (value) => {
          filter.value = value;
          filter.property = col.property;
          col.filter = filter;
          this.recomputeFilteredRows();
          this.render();
        },
      });
      valCombo.mount(valWrap, filter.value ?? "");
      const values = this.plugin.scanner.getPropertyValues(
        this.allRows,
        col.property,
        80,
      );
      valCombo.setOptions(
        values.map((v) => ({
          value: v.value,
          label: v.value,
          meta: String(v.count),
        })),
      );
      window.setTimeout(() => valCombo.focus(), 0);
    }

    const csRow = pop.createDiv({ cls: "fm-editor-popover-row" });
    const csLabel = csRow.createEl("label", { cls: "fm-editor-checkbox-line" });
    const csInput = csLabel.createEl("input", { type: "checkbox" });
    csInput.checked = !!filter.caseSensitive;
    csLabel.appendText("Case sensitive");
    csInput.addEventListener("change", () => {
      filter.caseSensitive = csInput.checked;
      col.filter = filter;
      this.recomputeFilteredRows();
      this.render();
    });

    const actions = pop.createDiv({ cls: "fm-editor-popover-actions" });
    const clearBtn = actions.createEl("button", {
      text: "Clear",
      cls: "fm-editor-btn",
    });
    clearBtn.addEventListener("click", () => {
      col.filter = null;
      this.openFilterPopoverFor = null;
      this.recomputeFilteredRows();
      this.render();
    });
    const closeBtn = actions.createEl("button", {
      text: "Done",
      cls: "fm-editor-btn mod-cta",
    });
    closeBtn.addEventListener("click", () => {
      this.openFilterPopoverFor = null;
      this.render();
    });
  }

  private cycleSort(col: ColumnState): void {
    if (col.sort === null) col.sort = "asc";
    else if (col.sort === "asc") col.sort = "desc";
    else col.sort = null;
    this.recomputeFilteredRows();
    this.render();
  }

  // ============================================================ THEN BAR

  private renderActionBar(parent: HTMLElement): void {
    const bar = parent.createDiv({ cls: "fm-editor-action-bar" });

    const head = bar.createDiv({ cls: "fm-editor-action-head" });
    const label = head.createDiv({ cls: "fm-editor-action-label-block" });
    label.createSpan({
      cls: "fm-editor-action-meta-label",
      text: "THEN",
    });
    label.createSpan({
      cls: "fm-editor-section-sublabel",
      text: "apply one action",
    });

    this.actionHintEl = head.createDiv({ cls: "fm-editor-action-meta-hint" });
    this.updateActionBarHint();

    const buttons = bar.createDiv({ cls: "fm-editor-action-buttons" });

    const setBtn = this.makeActionButton(
      buttons,
      "file-plus",
      "Set property",
      "Write a value into a property on every matched note",
    );
    setBtn.addEventListener("click", () => this.openSetModal());

    const renameBtn = this.makeActionButton(
      buttons,
      "pen-line",
      "Rename",
      "Change a property's name (1 → 1)",
    );
    renameBtn.addEventListener("click", () => this.openRenameModal());

    // Unified Copy / Move surface. Mode toggle inside the modal
    // distinguishes "Copy (keep source)" from "Move (delete source)".
    // The previous separate Copy + Merge buttons were redundant -- Merge
    // was just a Move with a >= 2 source guard.
    const transferBtn = this.makeActionButton(
      buttons,
      "arrow-right-left",
      "Copy / Move",
      "Transfer values between properties, optionally rewriting or merging values during the transfer",
    );
    transferBtn.addEventListener("click", () => this.openTransferModal());

    const dedupeBtn = this.makeActionButton(
      buttons,
      "link",
      "Dedupe links",
      "Collapse frontmatter wikilinks that point at the same file (e.g. [[Folder/Name]] + [[Name]]) to one canonical link",
    );
    dedupeBtn.addEventListener("click", () => void this.runDedupe());

    const delBtn = this.makeActionButton(
      buttons,
      "trash-2",
      "Delete properties",
      "Remove one or more properties entirely (key + value)",
    );
    delBtn.addClass("fm-editor-btn-destructive");
    delBtn.addEventListener("click", () => this.openDeleteModal());
  }

  private makeActionButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    title: string,
  ): HTMLButtonElement {
    const btn = parent.createEl("button", { cls: "fm-editor-action-btn" });
    const iconWrap = btn.createSpan({ cls: "fm-editor-action-btn-icon" });
    setIcon(iconWrap, icon);
    btn.createSpan({
      cls: "fm-editor-action-btn-label",
      text: label,
    });
    btn.title = title;
    return btn;
  }

  private async runDedupe(): Promise<void> {
    const targets = this.getTargetRows();
    if (targets.length === 0) {
      new Notice("No notes targeted — adjust the rule first.");
      return;
    }
    await this.plugin.runWikilinkDedup({ paths: targets.map((r) => r.path) });
  }

  private getTargetRows(): NoteRow[] {
    if (this.selectedPaths.size === 0) return this.filteredRows;
    return this.filteredRows.filter((r) => this.selectedPaths.has(r.path));
  }

  private updateActionBarHint(): void {
    if (!this.actionHintEl) return;
    this.actionHintEl.empty();
    const targets = this.getTargetRows();
    const explicit = this.selectedPaths.size > 0;
    const arrow = this.actionHintEl.createSpan({
      cls: "fm-editor-action-meta-arrow",
    });
    setIcon(arrow, "corner-down-right");
    this.actionHintEl.appendText(" runs on ");
    this.actionHintEl.createSpan({
      cls: "fm-editor-action-meta-count",
      text: `${targets.length} ${targets.length === 1 ? "note" : "notes"}`,
    });
    this.actionHintEl.appendText(
      explicit
        ? " currently ticked in the table."
        : " currently matched by the WHEN conditions.",
    );
  }

  private openSetModal(): void {
    const targets = this.getTargetRows();
    if (targets.length === 0) {
      new Notice("No notes targeted — adjust the rule first.");
      return;
    }
    new SetActionModal(
      this.app,
      this.plugin,
      targets,
      this.inventory,
      () => {
        void this.refreshScan().then(() => this.render());
      },
    ).open();
  }

  private openDeleteModal(): void {
    const targets = this.getTargetRows();
    if (targets.length === 0) {
      new Notice("No notes targeted — adjust the rule first.");
      return;
    }
    new DeleteActionModal(
      this.app,
      this.plugin,
      targets,
      this.inventory,
      () => {
        void this.refreshScan().then(() => this.render());
      },
    ).open();
  }

  private openRenameModal(): void {
    const targets = this.getTargetRows();
    if (targets.length === 0) {
      new Notice("No notes targeted — adjust the rule first.");
      return;
    }
    new RenameActionModal(
      this.app,
      this.plugin,
      targets,
      this.inventory,
      () => {
        void this.refreshScan().then(() => this.render());
      },
    ).open();
  }

  private openTransferModal(
    preselectedSource?: string,
    initialMode?: "copy" | "move",
  ): void {
    const targets = this.getTargetRows();
    if (targets.length === 0) {
      new Notice("No notes targeted -- adjust the rule first.");
      return;
    }
    new CopyMergeActionModal(
      this.app,
      this.plugin,
      targets,
      this.inventory,
      () => {
        void this.refreshScan().then(() => this.render());
      },
      preselectedSource,
      initialMode,
    ).open();
  }

  private openGenerateModalForProperty(targetProperty: string): void {
    const matched = this.filteredRows;
    const ticked = matched.filter((r) => this.selectedPaths.has(r.path));
    new GenerateActionModal(
      this.app,
      this.plugin,
      {
        targetProperty,
        matchedRows: matched,
        tickedRows: ticked,
        activeFile: this.app.workspace.getActiveFile() ?? null,
      },
      () => {
        void this.refreshScan().then(() => this.render());
      },
    ).open();
  }

  private openDeleteForProperty(property: string): void {
    const targets = this.getTargetRows();
    if (targets.length === 0) {
      new Notice("No notes targeted — adjust the rule first.");
      return;
    }
    new DeleteActionModal(
      this.app,
      this.plugin,
      targets,
      this.inventory,
      () => {
        void this.refreshScan().then(() => this.render());
      },
      [property],
    ).open();
  }
}

function operatorNeedsValue(op: FilterOperator): boolean {
  switch (op) {
    case "exists":
    case "not_exists":
    case "is_empty":
    case "is_not_empty":
    case "is_list":
    case "is_string":
      return false;
    default:
      return true;
  }
}

function humanOp(op: FilterOperator): string {
  switch (op) {
    case "exists":
      return "exists";
    case "not_exists":
      return "does not exist";
    case "equals":
      return "equals";
    case "not_equals":
      return "does not equal";
    case "contains":
      return "contains";
    case "not_contains":
      return "does not contain";
    case "starts_with":
      return "starts with";
    case "ends_with":
      return "ends with";
    case "matches_regex":
      return "matches regex";
    case "is_empty":
      return "is empty";
    case "is_not_empty":
      return "is not empty";
    case "is_list":
      return "is list";
    case "is_string":
      return "is string";
    case "in_path":
      return "path contains";
  }
}

function compareValues(a: unknown, b: unknown): number {
  const aMissing = a === undefined || a === null;
  const bMissing = b === undefined || b === null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") {
    return a === b ? 0 : a ? 1 : -1;
  }
  const as = Array.isArray(a) ? a.join(", ") : String(a);
  const bs = Array.isArray(b) ? b.join(", ") : String(b);
  return as.localeCompare(bs, undefined, { numeric: true });
}

