/**
 * ValueMappingTable -- inline component rendered inside
 * CopyMergeActionModal. Two-column source/target table that lets the
 * user rewrite distinct values, fold many-to-one, and apply bulk
 * transforms (lowercase, trim, titlecase, strip-diacritics).
 *
 * Inspired by Power Query's Replace Values dialog + Tableau Prep's
 * group-and-replace profile card, condensed into one Obsidian modal
 * section. Pass-through is EXPLICIT: every row shows the source value
 * pre-filled in the target field, with a "(=)" hint while the user
 * hasn't touched it.
 *
 * Pure DOM (no framework) to stay within Obsidian's Review-Bot rules.
 * Emits a ValueMapping[] + ValueTransform[] via getMappings() /
 * getTransforms(); the host modal collects these into the TransferAction.
 */

import { setIcon } from "obsidian";
import {
  VALUE_TRANSFORMS,
  VALUE_TRANSFORM_LABELS,
  type ValueMapping,
  type ValueTransform,
} from "../../types";
import { applyTransforms } from "../../services/ValueMappingEngine";

const MAX_INLINE_ROWS = 500;
const HARD_LIMIT = 2000;

export interface DistinctValue {
  value: string;
  count: number;
}

/**
 * One in-table row -- internal representation that combines the
 * scanned distinct value (source + count) with the user's edits
 * (target string + edited flag + selected flag for the multi-merge
 * action).
 */
interface Row {
  source: string;
  count: number;
  /** User-typed target. Empty target = "drop this value". */
  target: string;
  /** True when the user has hand-edited the target field. Sticky --
   *  bulk transforms skip edited rows. */
  userEdited: boolean;
  /** Selected for the multi-merge popover. */
  selected: boolean;
}

export interface ValueMappingTableHost {
  /** Triggered whenever the user changes a target, applies a transform,
   *  or toggles selection -- lets the parent modal refresh its live
   *  preview counters and pre-flight numbers. */
  onChange(): void;
}

export class ValueMappingTable {
  private rows: Row[] = [];
  private transforms: Set<ValueTransform> = new Set();
  private filter = "";
  private rootEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private mergeOpen = false;
  private mergeInput: HTMLInputElement | null = null;
  private multiselectRowEl: HTMLElement | null = null;
  private selectedCountEl: HTMLElement | null = null;

  constructor(
    private distinctValues: DistinctValue[],
    private host: ValueMappingTableHost,
  ) {
    this.rows = distinctValues.map((d) => ({
      source: d.value,
      count: d.count,
      target: d.value, // identity / pass-through default
      userEdited: false,
      selected: false,
    }));
  }

  // -------------------------------------------------- rendering

  mount(parent: HTMLElement): void {
    this.rootEl = parent.createDiv({ cls: "fm-editor-vm-body" });

    if (this.distinctValues.length === 0) {
      this.rootEl.createDiv({
        cls: "fm-editor-vm-empty",
        text:
          "No distinct values found on the selected notes for these source properties.",
      });
      return;
    }

    if (this.distinctValues.length > HARD_LIMIT) {
      this.rootEl.createDiv({
        cls: "fm-editor-vm-too-many",
        text: `Too many distinct values (${this.distinctValues.length.toLocaleString()}) for inline mapping. Use the bulk transforms above only, or narrow the WHEN clause to a smaller note set.`,
      });
    }

    this.renderQuickTransformChips(this.rootEl);
    this.renderFilterRow(this.rootEl);
    this.renderTable(this.rootEl);
    this.renderMultiSelectRow(this.rootEl);
  }

  private renderQuickTransformChips(parent: HTMLElement): void {
    const chips = parent.createDiv({ cls: "fm-editor-vm-chips" });
    for (const t of VALUE_TRANSFORMS) {
      const chip = chips.createEl("button", {
        cls: "fm-editor-vm-chip",
        text: VALUE_TRANSFORM_LABELS[t],
      });
      chip.addEventListener("click", () => {
        if (this.transforms.has(t)) this.transforms.delete(t);
        else this.transforms.add(t);
        chip.toggleClass("is-active", this.transforms.has(t));
        this.applyTransformsToUneditedRows();
        this.refreshBody();
        this.host.onChange();
      });
    }
    const reset = chips.createEl("button", {
      cls: "fm-editor-vm-chip fm-editor-vm-chip-reset",
      text: "Reset to source",
    });
    reset.addEventListener("click", () => {
      this.transforms.clear();
      for (const row of this.rows) {
        row.target = row.source;
        row.userEdited = false;
        row.selected = false;
      }
      chips
        .querySelectorAll<HTMLElement>(".fm-editor-vm-chip.is-active")
        .forEach((el) => el.removeClass("is-active"));
      this.refreshBody();
      this.host.onChange();
    });
  }

  private renderFilterRow(parent: HTMLElement): void {
    if (this.distinctValues.length <= 10) return; // filter only helps with longer lists
    const row = parent.createDiv({ cls: "fm-editor-vm-filter-row" });
    const input = row.createEl("input", {
      cls: "fm-editor-vm-filter-input",
      attr: { type: "search", placeholder: "Search source / target..." },
    });
    input.addEventListener("input", () => {
      this.filter = input.value;
      this.refreshBody();
    });
    row.createSpan({
      cls: "fm-editor-vm-count",
      text: `${this.distinctValues.length} distinct`,
    });
  }

  private renderTable(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: "fm-editor-vm-table-wrap" });
    const table = wrap.createEl("table", { cls: "fm-editor-vm-table" });
    const thead = table.createEl("thead");
    const hr = thead.createEl("tr");
    hr.createEl("th", { cls: "vm-col-check", text: "" });
    hr.createEl("th", { cls: "vm-col-source", text: "Source value" });
    hr.createEl("th", { cls: "vm-col-count", text: "Count" });
    hr.createEl("th", { cls: "vm-col-arrow", text: "" });
    hr.createEl("th", { cls: "vm-col-target", text: "Target value" });
    this.bodyEl = table.createEl("tbody");
    this.refreshBody();
  }

  private refreshBody(): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    const filter = this.filter.toLowerCase();
    const visible: Row[] = filter
      ? this.rows.filter(
          (r) =>
            r.source.toLowerCase().includes(filter) ||
            r.target.toLowerCase().includes(filter),
        )
      : this.rows;
    const limited = visible.slice(0, MAX_INLINE_ROWS);
    for (const row of limited) this.renderRow(this.bodyEl, row);
    if (visible.length > MAX_INLINE_ROWS) {
      const tr = this.bodyEl.createEl("tr");
      const td = tr.createEl("td", { attr: { colspan: "5" } });
      td.setText(
        `... ${visible.length - MAX_INLINE_ROWS} more rows -- narrow the filter or use bulk transforms.`,
      );
      td.style.setProperty("color", "var(--text-muted)");
      td.style.setProperty("font-style", "italic");
      td.style.setProperty("text-align", "center");
    }
    this.updateMultiSelectCount();
  }

  private renderRow(tbody: HTMLElement, row: Row): void {
    const tr = tbody.createEl("tr");
    if (row.userEdited) tr.addClass("is-edited");

    // checkbox
    const checkTd = tr.createEl("td", { cls: "vm-col-check" });
    const cb = checkTd.createEl("input", { type: "checkbox" });
    cb.checked = row.selected;
    cb.addEventListener("change", () => {
      row.selected = cb.checked;
      this.updateMultiSelectCount();
    });

    // source
    tr.createEl("td", { cls: "vm-col-source", text: row.source });

    // count
    tr.createEl("td", {
      cls: "vm-col-count",
      text: row.count.toLocaleString(),
    });

    // arrow
    tr.createEl("td", { cls: "vm-col-arrow", text: "->" });

    // target
    const targetTd = tr.createEl("td", { cls: "vm-col-target" });
    const input = targetTd.createEl("input", { type: "text" });
    input.value = row.target;
    if (!row.userEdited) input.addClass("is-passthrough");
    input.addEventListener("input", () => {
      row.target = input.value;
      row.userEdited = input.value !== this.transformedSource(row.source);
      input.toggleClass("is-passthrough", !row.userEdited);
      tr.toggleClass("is-edited", row.userEdited);
      this.host.onChange();
    });
  }

  private renderMultiSelectRow(parent: HTMLElement): void {
    this.multiselectRowEl = parent.createDiv({
      cls: "fm-editor-vm-multiselect-row is-hidden",
    });
    this.selectedCountEl = this.multiselectRowEl.createSpan();
    const mergeBtn = this.multiselectRowEl.createEl("button", {
      cls: "fm-editor-btn",
    });
    setIcon(mergeBtn.createSpan(), "merge");
    mergeBtn.createSpan({ text: " Merge selected into..." });
    mergeBtn.addEventListener("click", () => this.toggleMergePopover(parent));
    const clearBtn = this.multiselectRowEl.createEl("button", {
      cls: "fm-editor-btn",
      text: "Clear selection",
    });
    clearBtn.addEventListener("click", () => {
      for (const row of this.rows) row.selected = false;
      this.refreshBody();
    });
  }

  private toggleMergePopover(parent: HTMLElement): void {
    if (this.mergeOpen) {
      this.mergeOpen = false;
      parent.querySelector(".fm-editor-vm-merge-popover")?.remove();
      return;
    }
    this.mergeOpen = true;
    const popover = parent.createDiv({ cls: "fm-editor-vm-merge-popover" });
    popover.createSpan({ text: "Set target value to:" });
    const input = popover.createEl("input", {
      type: "text",
      attr: { placeholder: "e.g. person" },
    });
    this.mergeInput = input;
    const applyBtn = popover.createEl("button", {
      cls: "fm-editor-btn mod-cta",
      text: "Apply to selected",
    });
    const cancelBtn = popover.createEl("button", {
      cls: "fm-editor-btn",
      text: "Cancel",
    });
    const finalize = (commit: boolean): void => {
      const target = input.value.trim();
      if (commit && target) {
        for (const row of this.rows) {
          if (row.selected) {
            row.target = target;
            row.userEdited = true;
            row.selected = false;
          }
        }
        this.refreshBody();
        this.host.onChange();
      }
      this.mergeOpen = false;
      popover.remove();
      this.mergeInput = null;
    };
    applyBtn.addEventListener("click", () => finalize(true));
    cancelBtn.addEventListener("click", () => finalize(false));
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") finalize(true);
      if (ev.key === "Escape") finalize(false);
    });
    input.focus();
  }

  private updateMultiSelectCount(): void {
    if (!this.multiselectRowEl || !this.selectedCountEl) return;
    const count = this.rows.filter((r) => r.selected).length;
    this.selectedCountEl.setText(
      `${count} of ${this.rows.length} selected`,
    );
    this.multiselectRowEl.toggleClass("is-hidden", count === 0);
  }

  // -------------------------------------------------- bulk transform application

  private applyTransformsToUneditedRows(): void {
    const ts = Array.from(this.transforms);
    for (const row of this.rows) {
      if (row.userEdited) continue;
      row.target = applyTransforms(row.source, ts);
    }
  }

  private transformedSource(source: string): string {
    return applyTransforms(source, Array.from(this.transforms));
  }

  // -------------------------------------------------- public API

  getTransforms(): ValueTransform[] {
    return Array.from(this.transforms);
  }

  /**
   * Sparse mapping list: only rows whose final target differs from the
   * (post-transform) source are returned. Identity rows pass through.
   */
  getMappings(): ValueMapping[] {
    const ts = Array.from(this.transforms);
    const out: ValueMapping[] = [];
    for (const row of this.rows) {
      if (!row.userEdited) continue;
      const transformedSource = applyTransforms(row.source, ts);
      if (row.target === transformedSource) continue;
      out.push({
        source: transformedSource,
        target: row.target,
        userEdited: true,
      });
    }
    return out;
  }

  /**
   * Group mappings by target value for the preview bullets (e.g.
   * "Person + Teilnehmer -> person, 30 notes").
   */
  getPreviewGroups(): Array<{
    target: string;
    sources: string[];
    affectedNotes: number;
  }> {
    const groups = new Map<
      string,
      { target: string; sources: string[]; affectedNotes: number }
    >();
    for (const row of this.rows) {
      if (!row.userEdited) continue;
      const key = row.target;
      let g = groups.get(key);
      if (!g) {
        g = { target: row.target, sources: [], affectedNotes: 0 };
        groups.set(key, g);
      }
      g.sources.push(row.source);
      g.affectedNotes += row.count;
    }
    return Array.from(groups.values()).sort(
      (a, b) => b.affectedNotes - a.affectedNotes,
    );
  }
}
