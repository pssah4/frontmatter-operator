import { Setting, setIcon } from "obsidian";
import type { BulkAction } from "../../types";
import { BaseActionModal } from "./BaseActionModal";

export class CopyActionModal extends BaseActionModal {
  private fromProperties: string[] = [];
  private toProperty = "";
  private onConflict: "skip" | "overwrite" | "merge_list" = "skip";
  private wrapWikilink = false;
  private chipsHostEl: HTMLElement | null = null;

  protected title(): string {
    return "Copy property values";
  }

  protected buildForm(container: HTMLElement): void {
    container.createDiv({
      cls: "fm-editor-modal-hint",
      text: "Copy values from one or more source properties into a target property. The sources stay in place. To merge several sources into one and delete the originals afterwards, use Merge instead.",
    });

    this.buildSourcePicker(container);

    new Setting(container)
      .setName("Target property")
      .setDesc("Where the values are copied to.")
      .addText((text) => {
        text
          .setPlaceholder("e.g. moc")
          .onChange((value) => {
            this.toProperty = value;
          });
        text.inputEl.setAttribute("list", "fm-editor-copy-to-list");
      })
      .then((s) =>
        this.propertyDatalist(s.controlEl, "fm-editor-copy-to-list"),
      );

    new Setting(container)
      .setName("If target already has a value")
      .setDesc("Behavior on notes where the target already exists.")
      .addDropdown((d) => {
        d.addOption("skip", "Skip this note (do not copy)");
        d.addOption("overwrite", "Overwrite target with source value");
        d.addOption("merge_list", "Merge into list with existing value");
        d.setValue(this.onConflict);
        d.onChange((value) => {
          this.onConflict = value as typeof this.onConflict;
        });
      });

    new Setting(container)
      .setName("Wrap value as wikilink")
      .setDesc("Convert the copied value to [[wikilink]] if it isn't already.")
      .addToggle((t) => {
        t.setValue(this.wrapWikilink).onChange((v) => {
          this.wrapWikilink = v;
        });
      });
  }

  private buildSourcePicker(container: HTMLElement): void {
    const setting = new Setting(container)
      .setName("Source properties")
      .setDesc(
        "One or more properties whose values are copied into the target.",
      );
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
    addInput.setAttribute("list", "fm-editor-copy-from-list");
    this.propertyDatalist(addWrap, "fm-editor-copy-from-list");
    addInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        this.addFrom(addInput.value);
        addInput.value = "";
      }
    });
    const addBtn = addWrap.createEl("button", { cls: "fm-editor-btn" });
    setIcon(addBtn.createSpan(), "plus");
    addBtn.createSpan({ text: "Add" });
    addBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      this.addFrom(addInput.value);
      addInput.value = "";
      addInput.focus();
    });
    this.renderChips();
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
      const x = chip.createEl("button", { cls: "fm-editor-chip-remove" });
      setIcon(x, "x");
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
    return {
      type: "copy",
      fromProperties: [...this.fromProperties],
      toProperty: to,
      onConflict: this.onConflict,
      wrapWikilink: this.wrapWikilink,
    };
  }
}
