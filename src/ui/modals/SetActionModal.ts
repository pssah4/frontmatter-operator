import { Setting } from "obsidian";
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
  auto: "Auto-detects type from input. Numbers, booleans and lists are parsed; everything else stays a string.",
  string: "Forces the value to a string.",
  number: "Forces the value to a number.",
  boolean: "Forces true/false.",
  null: "Sets the property to null.",
  list: "Forces a list. Items split by commas; quotes preserved.",
  wikilink: "Wraps the value in [[ ]] if missing.",
  template:
    'Treats the value as a template. Use {{otherProperty}} to copy values per note. Example: {{Thema}} copies Thema into the target property.',
};

export class SetActionModal extends BaseActionModal {
  private property = "";
  private rawValue = "";
  private kind: ValueKind = "auto";
  private mode: "overwrite" | "skip_if_exists" | "merge_list" = "overwrite";
  private wrapWikilink = false;
  private hintEl: HTMLElement | null = null;
  private chipsEl: HTMLElement | null = null;
  private valueInput: HTMLInputElement | null = null;

  protected title(): string {
    return "Set property";
  }

  protected buildForm(container: HTMLElement): void {
    new Setting(container)
      .setName("Property")
      .setDesc("The frontmatter key to set.")
      .addText((text) => {
        text
          .setPlaceholder("e.g. type")
          .onChange((value) => {
            this.property = value;
          });
        text.inputEl.setAttribute("list", "fm-editor-set-prop-list");
      })
      .then((s) => this.propertyDatalist(s.controlEl, "fm-editor-set-prop-list"));

    new Setting(container)
      .setName("Value")
      .setDesc(
        "Literal value, or a template like {{Thema}} if Type is set to template.",
      )
      .addText((text) => {
        text
          .setPlaceholder("e.g. person  ·  [[Some Note]]  ·  {{Thema}}")
          .onChange((value) => {
            this.rawValue = value;
          });
        this.valueInput = text.inputEl;
      });

    new Setting(container)
      .setName("Type")
      .setDesc("How to interpret the value.")
      .addDropdown((d) => {
        for (const k of KINDS) d.addOption(k, k);
        d.setValue(this.kind);
        d.onChange((value) => {
          this.kind = value as ValueKind;
          this.updateHint();
          this.updateChips();
        });
      });

    new Setting(container)
      .setName("On conflict")
      .setDesc("What to do when the property already exists.")
      .addDropdown((d) => {
        d.addOption("overwrite", "overwrite");
        d.addOption("skip_if_exists", "skip if exists");
        d.addOption("merge_list", "merge into list");
        d.setValue(this.mode);
        d.onChange((value) => {
          this.mode = value as typeof this.mode;
        });
      });

    new Setting(container)
      .setName("Wrap as wikilink")
      .setDesc("Convert the resolved value to [[wikilink]] if it isn't already.")
      .addToggle((t) => {
        t.setValue(this.wrapWikilink).onChange((v) => {
          this.wrapWikilink = v;
        });
      });

    this.hintEl = container.createDiv({ cls: "fm-editor-modal-hint" });
    this.chipsEl = container.createDiv({ cls: "fm-editor-modal-chips" });
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

    this.chipsEl.createDiv({
      cls: "fm-editor-modal-chips-label",
      text: "Click to insert a property reference:",
    });
    const list = this.chipsEl.createDiv({ cls: "fm-editor-modal-chips-list" });
    const items = this.inventory.slice(0, 40);
    for (const p of items) {
      const chip = list.createEl("button", {
        cls: "fm-editor-pill",
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
        wrapWikilink: this.wrapWikilink,
      };
    }
    const value = parseValue(this.rawValue, this.kind);
    return {
      type: "set",
      property,
      value,
      mode: this.mode,
      wrapWikilink: this.wrapWikilink,
    };
  }
}
