import {
  ItemView,
  Notice,
  WorkspaceLeaf,
} from "obsidian";
import type FrontmatterEditorPlugin from "../main";
import type {
  Filter,
  FilterCombinator,
  FilterOperator,
  NoteRow,
  PropertyStat,
} from "../types";
import { FILTER_OPERATORS } from "../types";
import { applyFilters, evaluateFilter } from "../services/FilterEngine";
import { SetActionModal } from "./modals/SetActionModal";
import { DeleteActionModal } from "./modals/DeleteActionModal";
import { TransformActionModal } from "./modals/TransformActionModal";
import { SnapshotsModal } from "./modals/SnapshotsModal";

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
  private propertySearch = "";
  private columns: ColumnState[] = [];
  private dragSourceIndex: number | null = null;
  private openFilterPopoverFor: string | null = null;

  private actionHintEl: HTMLElement | null = null;

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
    return "list-tree";
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
    this.inventory = scan.properties;
    this.allRows = this.plugin.scanner.buildAllRows();
    if (this.columns.length === 0) {
      this.columns = this.suggestColumns();
    } else {
      this.columns = this.columns.filter((c) =>
        this.inventory.some((p) => p.name === c.property),
      );
    }
    this.recomputeFilteredRows();
  }

  private suggestColumns(): ColumnState[] {
    return this.inventory
      .slice(0, DEFAULT_COLUMN_COUNT)
      .map((p) => ({ property: p.name, sort: null, filter: null }));
  }

  private activeFilters(): Filter[] {
    const perCol = this.columns
      .map((c) => c.filter)
      .filter((f): f is Filter => !!f);
    return perCol;
  }

  private recomputeFilteredRows(): void {
    let rows = applyFilters(this.allRows, this.globalFilters, this.combinator);
    const perCol = this.activeFilters();
    if (perCol.length > 0) {
      rows = rows.filter((row) =>
        perCol.every((f) => evaluateFilter(f, row)),
      );
    }

    const sortCols = this.columns.filter((c) => c.sort !== null);
    if (sortCols.length > 0) {
      rows = rows.slice().sort((a, b) => {
        for (const col of sortCols) {
          const cmp = compareValues(
            a.frontmatter[col.property],
            b.frontmatter[col.property],
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
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("fm-editor-content");

    this.renderHeader(root);
    const main = root.createDiv({ cls: "fm-editor-main" });
    this.renderSidebar(main);
    this.renderRightPane(main);
  }

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: "fm-editor-header" });
    const title = header.createDiv({ cls: "fm-editor-title" });
    title.createSpan({ text: "Frontmatter Editor", cls: "fm-editor-title-text" });
    title.createSpan({
      text: ` -- ${this.allRows.length} notes with frontmatter, ${this.inventory.length} unique properties`,
      cls: "fm-editor-subtitle",
    });

    const toolbar = header.createDiv({ cls: "fm-editor-toolbar" });
    this.button(toolbar, "Refresh", async () => {
      await this.refreshScan();
      this.render();
    });
    this.button(toolbar, "Snapshots / Undo", () => {
      new SnapshotsModal(this.app, this.plugin, () => {
        void this.refreshScan().then(() => this.render());
      }).open();
    });
    this.button(toolbar, "Reset columns", () => {
      this.columns = this.suggestColumns();
      this.recomputeFilteredRows();
      this.render();
    });
  }

  private renderSidebar(parent: HTMLElement): void {
    const sidebar = parent.createDiv({ cls: "fm-editor-sidebar" });
    const head = sidebar.createDiv({ cls: "fm-editor-sidebar-head" });
    head.createEl("h3", {
      text: "Properties",
      cls: "fm-editor-section-title",
    });
    head.createSpan({
      text: `${this.columns.length} shown`,
      cls: "fm-editor-empty-hint",
    });

    const search = sidebar.createEl("input", {
      type: "text",
      cls: "fm-editor-prop-search",
      placeholder: "Filter property names...",
    });
    search.value = this.propertySearch;
    search.addEventListener("input", () => {
      this.propertySearch = search.value;
      this.renderInventory(list);
    });

    const list = sidebar.createDiv({ cls: "fm-editor-prop-list" });
    this.renderInventory(list);
  }

  private renderInventory(container: HTMLElement): void {
    container.empty();
    const needle = this.propertySearch.trim().toLowerCase();
    const items = needle
      ? this.inventory.filter((p) => p.name.toLowerCase().includes(needle))
      : this.inventory;

    if (items.length === 0) {
      container.createDiv({
        text: "No properties match the filter.",
        cls: "fm-editor-empty-hint",
      });
      return;
    }

    const visible = new Set(this.columns.map((c) => c.property));

    for (const prop of items) {
      const row = container.createDiv({ cls: "fm-editor-prop-item" });
      const cb = row.createEl("input", {
        type: "checkbox",
        cls: "fm-editor-prop-check",
      });
      cb.checked = visible.has(prop.name);
      cb.addEventListener("click", (ev) => ev.stopPropagation());
      cb.addEventListener("change", () => {
        this.toggleColumn(prop.name, cb.checked);
      });

      const nameWrap = row.createDiv({ cls: "fm-editor-prop-name-wrap" });
      const nameEl = nameWrap.createDiv({ cls: "fm-editor-prop-name" });
      nameEl.setText(prop.name);
      const typesEl = nameWrap.createDiv({ cls: "fm-editor-prop-types" });
      typesEl.setText(Array.from(prop.types).join(" / "));

      const countEl = row.createDiv({ cls: "fm-editor-prop-count" });
      countEl.setText(String(prop.count));

      row.title = `Samples:\n  ${prop.sampleValues.slice(0, 6).join("\n  ")}`;
      row.addEventListener("click", () => {
        this.toggleColumn(prop.name, !visible.has(prop.name));
      });
    }
  }

  private toggleColumn(property: string, on: boolean): void {
    const idx = this.columns.findIndex((c) => c.property === property);
    if (on && idx === -1) {
      this.columns.push({ property, sort: null, filter: null });
    } else if (!on && idx >= 0) {
      this.columns.splice(idx, 1);
    }
    this.recomputeFilteredRows();
    this.render();
  }

  private renderRightPane(parent: HTMLElement): void {
    const right = parent.createDiv({ cls: "fm-editor-right" });
    this.renderFilterBar(right);
    this.renderResultsTable(right);
    this.renderActionBar(right);
  }

  private renderFilterBar(parent: HTMLElement): void {
    const bar = parent.createDiv({ cls: "fm-editor-filter-bar" });
    const head = bar.createDiv({ cls: "fm-editor-filter-head" });
    head.createSpan({
      text: "Global filters",
      cls: "fm-editor-section-title",
    });

    const combo = head.createEl("select", { cls: "fm-editor-combo" });
    for (const opt of ["AND", "OR"] as const) {
      const o = combo.createEl("option", { value: opt, text: opt });
      if (this.combinator === opt) o.selected = true;
    }
    combo.addEventListener("change", () => {
      this.combinator = combo.value as FilterCombinator;
      this.recomputeFilteredRows();
      this.render();
    });

    this.button(head, "+ Add filter", () => {
      this.globalFilters.push({
        id: uid(),
        property: this.inventory[0]?.name ?? "",
        operator: "exists",
      });
      this.recomputeFilteredRows();
      this.render();
    });
    this.button(head, "Clear", () => {
      this.globalFilters = [];
      for (const c of this.columns) c.filter = null;
      this.recomputeFilteredRows();
      this.render();
    });

    const chips = bar.createDiv({ cls: "fm-editor-chip-list" });
    if (this.globalFilters.length === 0) {
      chips.createSpan({
        text: "No global filters. Per-column filters can be added via the funnel icon in the table headers.",
        cls: "fm-editor-empty-hint",
      });
    } else {
      for (const f of this.globalFilters) {
        this.renderGlobalChip(chips, f);
      }
    }
  }

  private renderGlobalChip(parent: HTMLElement, filter: Filter): void {
    const chip = parent.createDiv({ cls: "fm-editor-chip" });
    const propSelect = chip.createEl("select", { cls: "fm-editor-chip-prop" });
    const props = this.inventory.map((p) => p.name);
    if (!props.includes(filter.property) && filter.property) {
      props.unshift(filter.property);
    }
    for (const p of props) {
      const o = propSelect.createEl("option", { value: p, text: p });
      if (p === filter.property) o.selected = true;
    }
    propSelect.addEventListener("change", () => {
      filter.property = propSelect.value;
      this.recomputeFilteredRows();
      this.render();
    });

    const opSelect = chip.createEl("select", { cls: "fm-editor-chip-op" });
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
      const valInput = chip.createEl("input", {
        type: "text",
        cls: "fm-editor-chip-value",
        placeholder: "value",
      });
      valInput.value = filter.value ?? "";
      valInput.addEventListener("change", () => {
        filter.value = valInput.value;
        this.recomputeFilteredRows();
        this.render();
      });
      valInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") valInput.blur();
      });
    }

    const csLabel = chip.createEl("label", { cls: "fm-editor-chip-cs" });
    const csInput = csLabel.createEl("input", { type: "checkbox" });
    csInput.checked = !!filter.caseSensitive;
    csLabel.appendText("Aa");
    csInput.addEventListener("change", () => {
      filter.caseSensitive = csInput.checked;
      this.recomputeFilteredRows();
      this.render();
    });

    const remove = chip.createEl("button", {
      text: "x",
      cls: "fm-editor-chip-remove",
    });
    remove.addEventListener("click", () => {
      this.globalFilters = this.globalFilters.filter((x) => x.id !== filter.id);
      this.recomputeFilteredRows();
      this.render();
    });
  }

  private renderResultsTable(parent: HTMLElement): void {
    const box = parent.createDiv({ cls: "fm-editor-results-box" });
    const head = box.createDiv({ cls: "fm-editor-results-head" });

    const activeFilterCount = this.activeFilters().length;
    head.createSpan({
      text: `Results: ${this.filteredRows.length} note${this.filteredRows.length === 1 ? "" : "s"}` +
        (activeFilterCount > 0
          ? ` (${activeFilterCount} per-column filter${activeFilterCount === 1 ? "" : "s"} active)`
          : ""),
      cls: "fm-editor-section-title",
    });

    const allSelected =
      this.filteredRows.length > 0 &&
      this.filteredRows.every((r) => this.selectedPaths.has(r.path));
    const selBtn = head.createEl("button", {
      text: allSelected ? "Deselect all" : "Select all (filtered)",
      cls: "fm-editor-btn",
    });
    selBtn.addEventListener("click", () => {
      if (allSelected) {
        this.selectedPaths.clear();
      } else {
        for (const r of this.filteredRows) this.selectedPaths.add(r.path);
      }
      this.render();
    });

    const tableWrap = box.createDiv({ cls: "fm-editor-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "fm-editor-table" });
    const thead = table.createEl("thead");
    const headRow = thead.createEl("tr");
    headRow.createEl("th", { text: "", cls: "fm-editor-col-check" });

    const noteTh = headRow.createEl("th", { cls: "fm-editor-col-note-head" });
    noteTh.createSpan({ text: "Note" });

    this.columns.forEach((col, index) => {
      this.renderColumnHeader(headRow, col, index);
    });

    const tbody = table.createEl("tbody");
    const shown = this.filteredRows.slice(0, MAX_VISIBLE_ROWS);
    for (const row of shown) {
      const tr = tbody.createEl("tr");
      const checkTd = tr.createEl("td", { cls: "fm-editor-col-check" });
      const cb = checkTd.createEl("input", { type: "checkbox" });
      cb.checked = this.selectedPaths.has(row.path);
      cb.addEventListener("change", () => {
        if (cb.checked) this.selectedPaths.add(row.path);
        else this.selectedPaths.delete(row.path);
        this.updateActionBarHint();
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
        renderCell(td, row.frontmatter[col.property], (linkText) => {
          void this.app.workspace.openLinkText(linkText, row.path, false);
        });
      }
    }

    if (this.filteredRows.length > MAX_VISIBLE_ROWS) {
      box.createDiv({
        cls: "fm-editor-truncated-hint",
        text: `Showing first ${MAX_VISIBLE_ROWS} of ${this.filteredRows.length} results. Actions still run on all filtered notes.`,
      });
    }
  }

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

    const labelWrap = th.createDiv({ cls: "fm-editor-col-head-label" });
    const nameEl = labelWrap.createSpan({
      text: col.property,
      cls: "fm-editor-col-head-name",
    });
    nameEl.title = "Click to sort, drag to reorder";
    nameEl.addEventListener("click", () => {
      this.cycleSort(col);
    });

    const indicator = labelWrap.createSpan({ cls: "fm-editor-col-sort-ind" });
    if (col.sort === "asc") indicator.setText(" ▲");
    else if (col.sort === "desc") indicator.setText(" ▼");

    const actions = th.createDiv({ cls: "fm-editor-col-head-actions" });
    const filterBtn = actions.createEl("button", {
      cls: "fm-editor-col-icon-btn",
      text: col.filter ? "*" : "f",
    });
    filterBtn.title = col.filter ? "Edit column filter" : "Filter this column";
    filterBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.openFilterPopoverFor =
        this.openFilterPopoverFor === col.property ? null : col.property;
      this.render();
    });

    const removeBtn = actions.createEl("button", {
      cls: "fm-editor-col-icon-btn",
      text: "x",
    });
    removeBtn.title = "Hide this column";
    removeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.columns.splice(index, 1);
      this.recomputeFilteredRows();
      this.render();
    });

    if (this.openFilterPopoverFor === col.property) {
      this.renderColumnFilterPopover(th, col);
    }
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
      const valInput = valRow.createEl("input", {
        type: "text",
        placeholder: "value",
      });
      valInput.value = filter.value ?? "";
      const apply = () => {
        filter.value = valInput.value;
        filter.property = col.property;
        col.filter = filter;
        this.recomputeFilteredRows();
        this.render();
      };
      valInput.addEventListener("change", apply);
      valInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          apply();
        }
      });
      window.setTimeout(() => valInput.focus(), 0);
    }

    const csRow = pop.createDiv({ cls: "fm-editor-popover-row" });
    const csLabel = csRow.createEl("label", { cls: "fm-editor-chip-cs" });
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
      text: "Close",
      cls: "fm-editor-btn fm-editor-btn-primary",
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

  private renderActionBar(parent: HTMLElement): void {
    const bar = parent.createDiv({ cls: "fm-editor-action-bar" });
    this.actionHintEl = bar.createDiv({ cls: "fm-editor-action-hint" });
    this.updateActionBarHint();

    const buttons = bar.createDiv({ cls: "fm-editor-action-buttons" });
    this.button(buttons, "Set property...", () => this.openSetModal(), {
      primary: true,
    });
    this.button(buttons, "Delete property...", () => this.openDeleteModal());
    this.button(buttons, "Rename / Copy / Move...", () =>
      this.openTransformModal(),
    );
  }

  private getTargetRows(): NoteRow[] {
    if (this.selectedPaths.size === 0) return this.filteredRows;
    return this.filteredRows.filter((r) => this.selectedPaths.has(r.path));
  }

  private updateActionBarHint(): void {
    if (!this.actionHintEl) return;
    const targets = this.getTargetRows();
    const explicit = this.selectedPaths.size > 0;
    this.actionHintEl.setText(
      explicit
        ? `Actions will run on ${targets.length} selected note${targets.length === 1 ? "" : "s"}.`
        : `No selection -- actions will run on all ${targets.length} filtered note${targets.length === 1 ? "" : "s"}.`,
    );
  }

  private openSetModal(): void {
    const targets = this.getTargetRows();
    if (targets.length === 0) {
      new Notice("No notes targeted -- adjust filters first.");
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
      new Notice("No notes targeted -- adjust filters first.");
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

  private openTransformModal(): void {
    const targets = this.getTargetRows();
    if (targets.length === 0) {
      new Notice("No notes targeted -- adjust filters first.");
      return;
    }
    new TransformActionModal(
      this.app,
      this.plugin,
      targets,
      this.inventory,
      () => {
        void this.refreshScan().then(() => this.render());
      },
    ).open();
  }

  private button(
    parent: HTMLElement,
    label: string,
    cb: () => void,
    opts: { primary?: boolean } = {},
  ): HTMLButtonElement {
    const btn = parent.createEl("button", {
      text: label,
      cls: opts.primary
        ? "fm-editor-btn fm-editor-btn-primary"
        : "fm-editor-btn",
    });
    btn.addEventListener("click", () => cb());
    return btn;
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

const WIKILINK_RE = /^\[\[([^\]]+)\]\]$/;

function renderCell(
  td: HTMLElement,
  value: unknown,
  openLink: (target: string) => void,
): void {
  if (value === undefined) {
    td.addClass("fm-editor-cell-missing");
    return;
  }
  if (value === null) {
    td.addClass("fm-editor-cell-null");
    td.setText("null");
    return;
  }
  if (typeof value === "boolean") {
    td.addClass(value ? "fm-editor-cell-true" : "fm-editor-cell-false");
    td.setText(value ? "true" : "false");
    return;
  }
  if (typeof value === "number") {
    td.addClass("fm-editor-cell-num");
    td.setText(String(value));
    return;
  }
  if (Array.isArray(value)) {
    td.addClass("fm-editor-cell-list");
    const list = td.createDiv({ cls: "fm-editor-pills" });
    for (const item of value) {
      const pill = list.createSpan({ cls: "fm-editor-pill" });
      const s = typeof item === "string" ? item : String(item);
      const wl = s.match(WIKILINK_RE);
      if (wl) {
        pill.addClass("fm-editor-pill-link");
        const link = pill.createEl("a", { text: wl[1] });
        link.addEventListener("click", (ev) => {
          ev.preventDefault();
          openLink(wl[1]);
        });
      } else {
        pill.setText(s);
      }
    }
    return;
  }
  if (typeof value === "object") {
    td.addClass("fm-editor-cell-obj");
    td.setText(JSON.stringify(value));
    return;
  }
  const s = String(value);
  const wl = s.match(WIKILINK_RE);
  if (wl) {
    const link = td.createEl("a", {
      text: wl[1],
      cls: "fm-editor-note-link",
    });
    link.addEventListener("click", (ev) => {
      ev.preventDefault();
      openLink(wl[1]);
    });
    return;
  }
  td.setText(s);
}
