import type { BulkAction } from "../../types";
import { BaseActionModal } from "./BaseActionModal";

type Mode = "rename" | "copy" | "move";

export class TransformActionModal extends BaseActionModal {
  private mode: Mode = "rename";
  private fromProperties: string[] = [];
  private toProperty = "";
  private onConflict: "skip" | "overwrite" | "merge_list" = "skip";
  private wrapWikilink = false;
  private chipsHostEl: HTMLElement | null = null;
  private addInputEl: HTMLInputElement | null = null;

  protected title(): string {
    return "Rename / Copy / Move";
  }

  protected buildForm(container: HTMLElement): void {
    const modeRow = container.createDiv({ cls: "fm-editor-modal-row" });
    modeRow.createEl("label", { text: "Action" });
    const modeSel = modeRow.createEl("select");
    for (const m of ["rename", "copy", "move"] as const) {
      const o = modeSel.createEl("option", { value: m, text: m });
      if (m === this.mode) o.selected = true;
    }
    modeSel.addEventListener("change", () => {
      this.mode = modeSel.value as Mode;
    });

    const fromRow = container.createDiv({ cls: "fm-editor-modal-row" });
    fromRow.createEl("label", { text: "From properties" });
    const fromWrap = fromRow.createDiv({ cls: "fm-editor-multi-source" });

    this.chipsHostEl = fromWrap.createDiv({
      cls: "fm-editor-multi-source-chips",
    });

    const addWrap = fromWrap.createDiv({ cls: "fm-editor-multi-source-add" });
    const addInput = addWrap.createEl("input", {
      type: "text",
      placeholder: "Add source property, then Enter",
    });
    addInput.setAttribute("list", "fm-editor-multi-from-list");
    this.propertyDatalist(addWrap, "fm-editor-multi-from-list");
    this.addInputEl = addInput;
    addInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        this.addFrom(addInput.value);
        addInput.value = "";
      }
    });
    const addBtn = addWrap.createEl("button", {
      text: "Add",
      cls: "fm-editor-btn",
    });
    addBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      this.addFrom(addInput.value);
      addInput.value = "";
      addInput.focus();
    });
    this.renderChips();

    const toRow = container.createDiv({ cls: "fm-editor-modal-row" });
    toRow.createEl("label", { text: "To property" });
    const toInput = toRow.createEl("input", {
      type: "text",
      placeholder: "e.g. description",
    });
    toInput.setAttribute("list", "fm-editor-rename-to-list");
    toInput.addEventListener("input", () => {
      this.toProperty = toInput.value;
    });
    this.propertyDatalist(toRow, "fm-editor-rename-to-list");

    const conflictRow = container.createDiv({ cls: "fm-editor-modal-row" });
    conflictRow.createEl("label", { text: "If target exists" });
    const conflictSel = conflictRow.createEl("select");
    for (const c of ["skip", "overwrite", "merge_list"] as const) {
      const o = conflictSel.createEl("option", { value: c, text: c });
      if (c === this.onConflict) o.selected = true;
    }
    conflictSel.addEventListener("change", () => {
      this.onConflict = conflictSel.value as typeof this.onConflict;
    });

    const wlRow = container.createDiv({ cls: "fm-editor-modal-row" });
    wlRow.createEl("label", { text: "Wrap as wikilink" });
    const wlLabel = wlRow.createEl("label", {
      cls: "fm-editor-checkbox-line",
    });
    const wlCheck = wlLabel.createEl("input", { type: "checkbox" });
    wlCheck.checked = this.wrapWikilink;
    wlLabel.appendText(" Convert values to [[wikilinks]] before writing");
    wlCheck.addEventListener("change", () => {
      this.wrapWikilink = wlCheck.checked;
    });

    container.createDiv({
      cls: "fm-editor-empty-hint",
      text: "Multiple source properties are merged into the target. rename and move delete the sources afterwards; copy keeps them. Existing wikilinks stay as-is.",
    });
  }

  private addFrom(raw: string): void {
    const name = raw.trim();
    if (!name) return;
    if (this.fromProperties.includes(name)) return;
    this.fromProperties.push(name);
    this.renderChips();
  }

  private removeFrom(name: string): void {
    this.fromProperties = this.fromProperties.filter((p) => p !== name);
    this.renderChips();
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
      const chip = host.createSpan({ cls: "fm-editor-pill fm-editor-pill-link" });
      chip.createSpan({ text: name });
      const x = chip.createEl("button", {
        text: "x",
        cls: "fm-editor-chip-remove",
      });
      x.title = "Remove source";
      x.addEventListener("click", (ev) => {
        ev.preventDefault();
        this.removeFrom(name);
      });
    }
  }

  protected buildAction(): BulkAction | { error: string } {
    if (this.fromProperties.length === 0) {
      return { error: "At least one source property required" };
    }
    const to = this.toProperty.trim();
    if (!to) return { error: "Target property required" };
    if (
      this.mode !== "copy" &&
      this.fromProperties.length === 1 &&
      this.fromProperties[0] === to
    ) {
      return { error: "Source and target are identical" };
    }
    return {
      type: this.mode,
      fromProperties: [...this.fromProperties],
      toProperty: to,
      onConflict: this.onConflict,
      wrapWikilink: this.wrapWikilink,
    };
  }
}
