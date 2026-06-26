import {
  ItemView,
  Notice,
  TFile,
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
import { applyFilters } from "../services/FilterEngine";
import { SetActionModal } from "./modals/SetActionModal";
import { DeleteActionModal } from "./modals/DeleteActionModal";
import { TransformActionModal } from "./modals/TransformActionModal";
import { SnapshotsModal } from "./modals/SnapshotsModal";

export const VIEW_TYPE_FRONTMATTER_EDITOR = "frontmatter-editor-view";

const MAX_VISIBLE_COLUMNS = 4;
const MAX_VISIBLE_ROWS = 500;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export class FrontmatterEditorView extends ItemView {
  private filters: Filter[] = [];
  private combinator: FilterCombinator = "AND";
  private inventory: PropertyStat[] = [];
  private allRows: NoteRow[] = [];
  private filteredRows: NoteRow[] = [];
  private selectedPaths = new Set<string>();
  private propertyFilter = "";
  private visibleColumns: string[] = [];

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
    this.recomputeFilteredRows();
  }

  private recomputeFilteredRows(): void {
    this.filteredRows = applyFilters(this.allRows, this.filters, this.combinator);
    if (this.visibleColumns.length === 0) {
      this.visibleColumns = this.suggestColumns();
    }
    this.selectedPaths = new Set(
      Array.from(this.selectedPaths).filter((p) =>
        this.filteredRows.some((r) => r.path === p),
      ),
    );
  }

  private suggestColumns(): string[] {
    const used = new Set<string>();
    for (const f of this.filters) used.add(f.property);
    const sorted = this.inventory
      .slice()
      .sort((a, b) => b.count - a.count)
      .map((p) => p.name);
    for (const name of sorted) {
      if (used.size >= MAX_VISIBLE_COLUMNS) break;
      used.add(name);
    }
    return Array.from(used).slice(0, MAX_VISIBLE_COLUMNS);
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
  }

  private renderSidebar(parent: HTMLElement): void {
    const sidebar = parent.createDiv({ cls: "fm-editor-sidebar" });
    sidebar.createEl("h3", { text: "Properties", cls: "fm-editor-section-title" });

    const search = sidebar.createEl("input", {
      type: "text",
      cls: "fm-editor-prop-search",
      placeholder: "Filter property names...",
    });
    search.value = this.propertyFilter;
    search.addEventListener("input", () => {
      this.propertyFilter = search.value;
      this.renderInventory(list);
    });

    const list = sidebar.createDiv({ cls: "fm-editor-prop-list" });
    this.renderInventory(list);
  }

  private renderInventory(container: HTMLElement): void {
    container.empty();
    const needle = this.propertyFilter.trim().toLowerCase();
    const items = needle
      ? this.inventory.filter((p) => p.name.toLowerCase().includes(needle))
      : this.inventory;
    for (const prop of items) {
      const row = container.createDiv({ cls: "fm-editor-prop-item" });
      const nameEl = row.createDiv({ cls: "fm-editor-prop-name" });
      nameEl.setText(prop.name);
      const countEl = row.createDiv({ cls: "fm-editor-prop-count" });
      countEl.setText(String(prop.count));
      row.title = `Types: ${Array.from(prop.types).join(", ")}\nSamples:\n  ${prop.sampleValues.slice(0, 4).join("\n  ")}`;
      row.addEventListener("click", () => {
        this.addFilter({
          id: uid(),
          property: prop.name,
          operator: "exists",
        });
      });
    }
    if (items.length === 0) {
      container.createDiv({
        text: "No properties match the filter.",
        cls: "fm-editor-empty-hint",
      });
    }
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
    head.createSpan({ text: "Filters", cls: "fm-editor-section-title" });

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
      this.addFilter({
        id: uid(),
        property: this.inventory[0]?.name ?? "",
        operator: "exists",
      });
    });

    this.button(head, "Clear", () => {
      this.filters = [];
      this.recomputeFilteredRows();
      this.render();
    });

    const chips = bar.createDiv({ cls: "fm-editor-chip-list" });
    if (this.filters.length === 0) {
      chips.createSpan({
        text: "No filters -- all notes with frontmatter shown",
        cls: "fm-editor-empty-hint",
      });
      return;
    }
    for (const f of this.filters) {
      this.renderFilterChip(chips, f);
    }
  }

  private renderFilterChip(parent: HTMLElement, filter: Filter): void {
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
      this.filters = this.filters.filter((x) => x.id !== filter.id);
      this.recomputeFilteredRows();
      this.render();
    });
  }

  private renderResultsTable(parent: HTMLElement): void {
    const box = parent.createDiv({ cls: "fm-editor-results-box" });
    const head = box.createDiv({ cls: "fm-editor-results-head" });
    head.createSpan({
      text: `Results: ${this.filteredRows.length} note${this.filteredRows.length === 1 ? "" : "s"}`,
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

    const colPicker = head.createEl("button", {
      text: "Columns...",
      cls: "fm-editor-btn",
    });
    colPicker.addEventListener("click", () => {
      const allProps = this.inventory.map((p) => p.name);
      const next = window.prompt(
        "Visible property columns (comma-separated, in display order):",
        this.visibleColumns.join(", "),
      );
      if (next === null) return;
      const wanted = next
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .filter((s) => allProps.includes(s));
      this.visibleColumns = wanted;
      this.render();
    });

    const tableWrap = box.createDiv({ cls: "fm-editor-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "fm-editor-table" });
    const thead = table.createEl("thead");
    const headRow = thead.createEl("tr");
    headRow.createEl("th", { text: "", cls: "fm-editor-col-check" });
    headRow.createEl("th", { text: "Note" });
    for (const col of this.visibleColumns) {
      headRow.createEl("th", { text: col });
    }

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
        void this.app.workspace.openLinkText(row.path, "", ev.metaKey || ev.ctrlKey);
      });

      for (const col of this.visibleColumns) {
        const td = tr.createEl("td", { cls: "fm-editor-col-val" });
        td.setText(formatValue(row.frontmatter[col]));
      }
    }

    if (this.filteredRows.length > MAX_VISIBLE_ROWS) {
      box.createDiv({
        cls: "fm-editor-truncated-hint",
        text: `Showing first ${MAX_VISIBLE_ROWS} of ${this.filteredRows.length} results. Actions still run on all filtered notes.`,
      });
    }
  }

  private actionBarEl: HTMLElement | null = null;
  private actionHintEl: HTMLElement | null = null;

  private renderActionBar(parent: HTMLElement): void {
    const bar = parent.createDiv({ cls: "fm-editor-action-bar" });
    this.actionBarEl = bar;

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

  private addFilter(filter: Filter): void {
    this.filters.push(filter);
    this.recomputeFilteredRows();
    this.render();
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

function formatValue(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "null";
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
