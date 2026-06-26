import { Setting } from "obsidian";
import type { BulkAction } from "../../types";
import { BaseActionModal } from "./BaseActionModal";

export class DeleteActionModal extends BaseActionModal {
  private property = "";

  protected title(): string {
    return "Delete property";
  }

  protected buildForm(container: HTMLElement): void {
    new Setting(container)
      .setName("Property to delete")
      .setDesc("Removes the property entirely from every matched note.")
      .addText((text) => {
        text
          .setPlaceholder("e.g. tags-old")
          .onChange((value) => {
            this.property = value;
          });
        text.inputEl.setAttribute("list", "fm-editor-del-prop-list");
      })
      .then((s) => this.propertyDatalist(s.controlEl, "fm-editor-del-prop-list"));

    container.createDiv({
      cls: "fm-editor-modal-hint",
      text: "A snapshot is written before the change, so you can undo from the toolbar or the Apply notice.",
    });
  }

  protected buildAction(): BulkAction | { error: string } {
    const property = this.property.trim();
    if (!property) return { error: "Property name required" };
    return { type: "delete", property };
  }
}
