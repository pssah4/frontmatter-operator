import type { BulkAction } from "../../types";
import { BaseActionModal } from "./BaseActionModal";

export class DeleteActionModal extends BaseActionModal {
  private property = "";

  protected title(): string {
    return "Delete property";
  }

  protected buildForm(container: HTMLElement): void {
    const row = container.createDiv({ cls: "fm-editor-modal-row" });
    row.createEl("label", { text: "Property to delete" });
    const input = row.createEl("input", {
      type: "text",
      placeholder: "e.g. tags-old",
    });
    input.setAttribute("list", "fm-editor-del-prop-list");
    input.addEventListener("input", () => {
      this.property = input.value;
    });
    this.propertyDatalist(row, "fm-editor-del-prop-list");

    container.createDiv({
      cls: "fm-editor-empty-hint",
      text: "Removes the property entirely. Snapshot is written before changes so you can undo.",
    });
  }

  protected buildAction(): BulkAction | { error: string } {
    const property = this.property.trim();
    if (!property) return { error: "Property name required" };
    return { type: "delete", property };
  }
}
