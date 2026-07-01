import { App, setIcon, Setting } from "obsidian";
import type FrontmatterEditorPlugin from "../../main";
import type { BulkAction, NoteRow, PropertyStat } from "../../types";
import { BaseActionModal } from "./BaseActionModal";
import { renderCallout } from "../callout";

export class DeleteActionModal extends BaseActionModal {
  private properties: string[];
  private chipsHostEl: HTMLElement | null = null;

  constructor(
    app: App,
    plugin: FrontmatterEditorPlugin,
    targets: NoteRow[],
    inventory: PropertyStat[],
    onDone: () => void,
    preselected: string[] = [],
  ) {
    super(app, plugin, targets, inventory, onDone);
    this.properties = [...preselected];
  }

  protected title(): string {
    return "Delete properties";
  }

  protected buildForm(container: HTMLElement): void {
    renderCallout(
      container,
      "Removes the listed properties (key + value) completely from every matched note. A snapshot is written first, so you can undo from the toolbar.",
    );

    this.buildPropertyPicker(container);
  }

  private buildPropertyPicker(container: HTMLElement): void {
    const setting = new Setting(container)
      .setName("Properties to delete")
      .setDesc("One or more frontmatter keys.");
    const control = setting.controlEl;
    control.addClass("fm-editor-multi-source");

    this.chipsHostEl = control.createDiv({
      cls: "fm-editor-multi-source-chips",
    });

    const addWrap = control.createDiv({ cls: "fm-editor-multi-source-add" });
    const addInput = addWrap.createEl("input", {
      type: "text",
      cls: "fm-editor-filter-input",
      placeholder: "Type property name, then Enter",
    });
    addInput.setAttribute("list", "fm-editor-delete-prop-list");
    this.propertyDatalist(addWrap, "fm-editor-delete-prop-list");
    addInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        this.add(addInput.value);
        addInput.value = "";
      }
    });
    const addBtn = addWrap.createEl("button", { cls: "fm-editor-btn" });
    setIcon(addBtn.createSpan(), "plus");
    addBtn.createSpan({ text: "Add" });
    addBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      this.add(addInput.value);
      addInput.value = "";
      addInput.focus();
    });
    this.renderChips();
  }

  private add(raw: string): void {
    const name = raw.trim();
    if (!name) return;
    if (this.properties.includes(name)) return;
    this.properties.push(name);
    this.renderChips();
  }

  private remove(name: string): void {
    this.properties = this.properties.filter((p) => p !== name);
    this.renderChips();
  }

  private renderChips(): void {
    const host = this.chipsHostEl;
    if (!host) return;
    host.empty();
    if (this.properties.length === 0) {
      host.createSpan({
        cls: "fm-editor-empty-hint",
        text: "No properties yet, add at least one",
      });
      return;
    }
    for (const name of this.properties) {
      const chip = host.createSpan({ cls: "fm-editor-pill fm-editor-pill-link" });
      chip.createSpan({ text: name });
      const x = chip.createEl("button", { cls: "fm-editor-chip-remove" });
      setIcon(x, "x");
      x.title = "Remove from list";
      x.addEventListener("click", (ev) => {
        ev.preventDefault();
        this.remove(name);
      });
    }
  }

  protected buildAction(): BulkAction | { error: string } {
    if (this.properties.length === 0) {
      return { error: "At least one property required" };
    }
    return { type: "delete", properties: [...this.properties] };
  }
}
