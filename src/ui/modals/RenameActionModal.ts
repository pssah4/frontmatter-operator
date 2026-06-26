import { Setting } from "obsidian";
import type { BulkAction } from "../../types";
import { BaseActionModal } from "./BaseActionModal";

export class RenameActionModal extends BaseActionModal {
  private fromProperty = "";
  private toProperty = "";
  private onConflict: "skip" | "overwrite" | "merge_list" = "skip";
  private wrapWikilink = false;

  protected title(): string {
    return "Rename a property";
  }

  protected buildForm(container: HTMLElement): void {
    container.createDiv({
      cls: "fm-editor-modal-hint",
      text: "Change a property's name without touching its value. The original key is deleted, the value is written under the new key.",
    });

    new Setting(container)
      .setName("Old name")
      .setDesc("The property as it exists today.")
      .addText((text) => {
        text
          .setPlaceholder("e.g. Beschreibung")
          .onChange((value) => {
            this.fromProperty = value;
          });
        text.inputEl.setAttribute("list", "fm-editor-rename-from-list");
      })
      .then((s) =>
        this.propertyDatalist(s.controlEl, "fm-editor-rename-from-list"),
      );

    new Setting(container)
      .setName("New name")
      .setDesc("The desired property name.")
      .addText((text) => {
        text
          .setPlaceholder("e.g. description")
          .onChange((value) => {
            this.toProperty = value;
          });
        text.inputEl.setAttribute("list", "fm-editor-rename-to-list");
      })
      .then((s) =>
        this.propertyDatalist(s.controlEl, "fm-editor-rename-to-list"),
      );

    new Setting(container)
      .setName("If new name already has a value")
      .setDesc("What to do when the target name is already in use on a note.")
      .addDropdown((d) => {
        d.addOption("skip", "Skip this note (keep both)");
        d.addOption("overwrite", "Overwrite target with old value");
        d.addOption("merge_list", "Merge both into a list");
        d.setValue(this.onConflict);
        d.onChange((value) => {
          this.onConflict = value as typeof this.onConflict;
        });
      });

    new Setting(container)
      .setName("Wrap value as wikilink")
      .setDesc("Convert the value to [[wikilink]] if it isn't already.")
      .addToggle((t) => {
        t.setValue(this.wrapWikilink).onChange((v) => {
          this.wrapWikilink = v;
        });
      });
  }

  protected buildAction(): BulkAction | { error: string } {
    const from = this.fromProperty.trim();
    const to = this.toProperty.trim();
    if (!from) return { error: "Old name required" };
    if (!to) return { error: "New name required" };
    if (from === to) return { error: "Old and new name are identical" };
    return {
      type: "rename",
      fromProperties: [from],
      toProperty: to,
      onConflict: this.onConflict,
      wrapWikilink: this.wrapWikilink,
    };
  }
}
