import type { BulkAction } from "../../types";
import { BaseActionModal } from "./BaseActionModal";

type Mode = "rename" | "copy" | "move";

export class TransformActionModal extends BaseActionModal {
  private mode: Mode = "rename";
  private fromProperty = "";
  private toProperty = "";
  private onConflict: "skip" | "overwrite" | "merge_list" = "skip";

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
    fromRow.createEl("label", { text: "From property" });
    const fromInput = fromRow.createEl("input", {
      type: "text",
      placeholder: "e.g. Beschreibung",
    });
    fromInput.setAttribute("list", "fm-editor-rename-from-list");
    fromInput.addEventListener("input", () => {
      this.fromProperty = fromInput.value;
    });
    this.propertyDatalist(fromRow, "fm-editor-rename-from-list");

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

    container.createDiv({
      cls: "fm-editor-empty-hint",
      text: "rename: source removed if target was free. copy: source kept. move: same as rename. Wikilinks and lists are preserved as-is.",
    });
  }

  protected buildAction(): BulkAction | { error: string } {
    const from = this.fromProperty.trim();
    const to = this.toProperty.trim();
    if (!from || !to) return { error: "From and to property required" };
    if (from === to && this.mode !== "copy") {
      return { error: "From and to are identical" };
    }
    return {
      type: this.mode,
      fromProperty: from,
      toProperty: to,
      onConflict: this.onConflict,
    };
  }
}
