import { Setting, setIcon } from "obsidian";
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

  protected title(): string {
    return "Rename, copy or move properties";
  }

  protected buildForm(container: HTMLElement): void {
    new Setting(container)
      .setName("Action")
      .setDesc(
        "Rename / move delete the source(s) after copying. Copy keeps them.",
      )
      .addDropdown((d) => {
        d.addOption("rename", "rename");
        d.addOption("copy", "copy");
        d.addOption("move", "move");
        d.setValue(this.mode);
        d.onChange((value) => {
          this.mode = value as Mode;
        });
      });

    const sourceSetting = new Setting(container)
      .setName("From properties")
      .setDesc("One or more source properties. Their values are merged into the target.");
    const sourceControl = sourceSetting.controlEl;
    sourceControl.addClass("fm-editor-multi-source");

    this.chipsHostEl = sourceControl.createDiv({
      cls: "fm-editor-multi-source-chips",
    });

    const addWrap = sourceControl.createDiv({ cls: "fm-editor-multi-source-add" });
    const addInput = addWrap.createEl("input", {
      type: "text",
      cls: "fm-editor-filter-input",
      placeholder: "Type property name, then Enter",
    });
    addInput.setAttribute("list", "fm-editor-multi-from-list");
    this.propertyDatalist(addWrap, "fm-editor-multi-from-list");
    addInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        this.addFrom(addInput.value);
        addInput.value = "";
      }
    });
    const addBtn = addWrap.createEl("button", {
      cls: "fm-editor-btn",
    });
    setIcon(addBtn.createSpan(), "plus");
    addBtn.createSpan({ text: "Add" });
    addBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      this.addFrom(addInput.value);
      addInput.value = "";
      addInput.focus();
    });
    this.renderChips();

    new Setting(container)
      .setName("To property")
      .setDesc("The destination property name.")
      .addText((text) => {
        text
          .setPlaceholder("e.g. description")
          .onChange((value) => {
            this.toProperty = value;
          });
        text.inputEl.setAttribute("list", "fm-editor-rename-to-list");
      })
      .then((s) => this.propertyDatalist(s.controlEl, "fm-editor-rename-to-list"));

    new Setting(container)
      .setName("If target exists")
      .setDesc("How to handle notes where the target property already has a value.")
      .addDropdown((d) => {
        d.addOption("skip", "skip");
        d.addOption("overwrite", "overwrite");
        d.addOption("merge_list", "merge into list");
        d.setValue(this.onConflict);
        d.onChange((value) => {
          this.onConflict = value as typeof this.onConflict;
        });
      });

    new Setting(container)
      .setName("Wrap as wikilink")
      .setDesc("Convert values to [[wikilink]] before writing. Existing wikilinks pass through.")
      .addToggle((t) => {
        t.setValue(this.wrapWikilink).onChange((v) => {
          this.wrapWikilink = v;
        });
      });

    container.createDiv({
      cls: "fm-editor-modal-hint",
      text: "Multiple sources are merged into the target (lists deduped). For rename and move, the sources are deleted afterwards; for copy they are kept.",
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
        cls: "fm-editor-chip-remove",
      });
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
