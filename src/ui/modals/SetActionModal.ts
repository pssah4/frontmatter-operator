import type { BulkAction } from "../../types";
import { parseValue, type ValueKind } from "../../services/ValueCoercion";
import { BaseActionModal } from "./BaseActionModal";

const KINDS: ValueKind[] = [
  "auto",
  "string",
  "number",
  "boolean",
  "null",
  "list",
  "wikilink",
];

export class SetActionModal extends BaseActionModal {
  private property = "";
  private rawValue = "";
  private kind: ValueKind = "auto";
  private mode: "overwrite" | "skip_if_exists" | "merge_list" = "overwrite";

  protected title(): string {
    return "Set property";
  }

  protected buildForm(container: HTMLElement): void {
    const propRow = container.createDiv({ cls: "fm-editor-modal-row" });
    propRow.createEl("label", { text: "Property" });
    const propInput = propRow.createEl("input", {
      type: "text",
      placeholder: "e.g. type",
    });
    propInput.setAttribute("list", "fm-editor-set-prop-list");
    propInput.addEventListener("input", () => {
      this.property = propInput.value;
    });
    this.propertyDatalist(propRow, "fm-editor-set-prop-list");

    const valRow = container.createDiv({ cls: "fm-editor-modal-row" });
    valRow.createEl("label", { text: "Value" });
    const valInput = valRow.createEl("input", {
      type: "text",
      placeholder: "e.g. person  or  [[Some Note]]  or  a, b, c",
    });
    valInput.addEventListener("input", () => {
      this.rawValue = valInput.value;
    });

    const kindRow = container.createDiv({ cls: "fm-editor-modal-row" });
    kindRow.createEl("label", { text: "Type" });
    const kindSel = kindRow.createEl("select");
    for (const k of KINDS) {
      const o = kindSel.createEl("option", { value: k, text: k });
      if (k === this.kind) o.selected = true;
    }
    kindSel.addEventListener("change", () => {
      this.kind = kindSel.value as ValueKind;
    });

    const modeRow = container.createDiv({ cls: "fm-editor-modal-row" });
    modeRow.createEl("label", { text: "On conflict" });
    const modeSel = modeRow.createEl("select");
    for (const m of ["overwrite", "skip_if_exists", "merge_list"] as const) {
      const o = modeSel.createEl("option", { value: m, text: m });
      if (m === this.mode) o.selected = true;
    }
    modeSel.addEventListener("change", () => {
      this.mode = modeSel.value as typeof this.mode;
    });
  }

  protected buildAction(): BulkAction | { error: string } {
    const property = this.property.trim();
    if (!property) return { error: "Property name required" };
    const value = parseValue(this.rawValue, this.kind);
    return {
      type: "set",
      property,
      value,
      mode: this.mode,
    };
  }
}
