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
  "template",
];

const KIND_HINTS: Record<ValueKind, string> = {
  auto: "Auto: detect type from input (numbers, booleans, lists, ...).",
  string: "Force string.",
  number: "Force number.",
  boolean: "Force true/false.",
  null: "Set to null.",
  list: "Force list. Split by commas.",
  wikilink: "Wrap value in [[ ]] if missing.",
  template:
    "Template. Use {{otherProperty}} to copy values per-note. Example: {{Thema}} writes the value of Thema into the target property.",
};

export class SetActionModal extends BaseActionModal {
  private property = "";
  private rawValue = "";
  private kind: ValueKind = "auto";
  private mode: "overwrite" | "skip_if_exists" | "merge_list" = "overwrite";
  private hintEl: HTMLElement | null = null;
  private chipsEl: HTMLElement | null = null;
  private valueInput: HTMLInputElement | null = null;

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
      placeholder: "e.g. person  or  [[Some Note]]  or  {{Thema}}",
    });
    valInput.addEventListener("input", () => {
      this.rawValue = valInput.value;
    });
    this.valueInput = valInput;

    const kindRow = container.createDiv({ cls: "fm-editor-modal-row" });
    kindRow.createEl("label", { text: "Type" });
    const kindSel = kindRow.createEl("select");
    for (const k of KINDS) {
      const o = kindSel.createEl("option", { value: k, text: k });
      if (k === this.kind) o.selected = true;
    }
    kindSel.addEventListener("change", () => {
      this.kind = kindSel.value as ValueKind;
      this.updateHint();
      this.updateChips();
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

    this.hintEl = container.createDiv({
      cls: "fm-editor-modal-hint",
    });
    this.chipsEl = container.createDiv({
      cls: "fm-editor-modal-chips",
    });
    this.updateHint();
    this.updateChips();
  }

  private updateHint(): void {
    if (!this.hintEl) return;
    this.hintEl.setText(KIND_HINTS[this.kind]);
  }

  private updateChips(): void {
    if (!this.chipsEl) return;
    this.chipsEl.empty();
    if (this.kind !== "template") return;

    const label = this.chipsEl.createDiv({
      cls: "fm-editor-modal-chips-label",
    });
    label.setText("Insert property reference:");
    const list = this.chipsEl.createDiv({ cls: "fm-editor-modal-chips-list" });
    const items = this.inventory.slice(0, 40);
    for (const p of items) {
      const chip = list.createEl("button", {
        cls: "fm-editor-pill fm-editor-pill-link",
        text: p.name,
      });
      chip.title = `Insert {{${p.name}}} at cursor`;
      chip.addEventListener("click", (ev) => {
        ev.preventDefault();
        this.insertTemplateRef(p.name);
      });
    }
  }

  private insertTemplateRef(propertyName: string): void {
    const input = this.valueInput;
    if (!input) return;
    const placeholder = `{{${propertyName}}}`;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const next =
      input.value.slice(0, start) + placeholder + input.value.slice(end);
    input.value = next;
    this.rawValue = next;
    const cursor = start + placeholder.length;
    input.setSelectionRange(cursor, cursor);
    input.focus();
  }

  protected buildAction(): BulkAction | { error: string } {
    const property = this.property.trim();
    if (!property) return { error: "Property name required" };
    if (this.kind === "template") {
      return {
        type: "set",
        property,
        value: this.rawValue,
        mode: this.mode,
        template: true,
      };
    }
    const value = parseValue(this.rawValue, this.kind);
    return {
      type: "set",
      property,
      value,
      mode: this.mode,
    };
  }
}
