import { App } from "obsidian";
import { DraggableModal } from "./DraggableModal";

interface Recipe {
  title: string;
  goal: string;
  steps: string[];
}

const RECIPES: Recipe[] = [
  {
    title: "Add a property to every note",
    goal: "Example: write type: note into every note in the vault.",
    steps: [
      "Clear all WHEN conditions (or never add any).",
      "Do not tick any rows in the table (empty selection means all matched).",
      "Click Set property in the THEN bar.",
      "Property: type · Value: note · Type: auto · On conflict: overwrite (or skip if exists for gap-filling only).",
      "Preview, then Apply rule.",
    ],
  },
  {
    title: "Conditional set: if Thema = Reise then moc = Reise",
    goal: "Example: tag every travel note with a Map of Content reference.",
    steps: [
      "WHEN bar: Add condition → Property Thema · Operator equals · Value Reise. The count badge shows how many notes match.",
      "Click Set property in the THEN bar.",
      "Property: moc · Value: Reise.",
      "Preview, Apply rule. The snapshot is written, so you can undo from the toolbar.",
    ],
  },
  {
    title: "Copy values across properties per note",
    goal: "Example: write moc = value-of-Thema on every note.",
    steps: [
      "WHEN: optional Thema is not empty to skip notes without a Thema.",
      "Click Set property.",
      "Property: moc · Type: template · Value: {{Thema}}. The chip list below the form lets you click a property to insert its reference.",
      "Tick Wrap as wikilink if you want [[Reise]] instead of plain Reise.",
      "Preview shows the resolved value per note. Apply rule.",
    ],
  },
  {
    title: "Combine multiple property values",
    goal: "Example: build display = Vorname Nachname.",
    steps: [
      "Set property.",
      "Property: display · Type: template · Value: {{Vorname}} {{Nachname}}.",
      "Each note gets its own resolved string.",
    ],
  },
  {
    title: "Rename a property",
    goal: "Example: change Beschreibung to description without changing values.",
    steps: [
      "Click Rename in the THEN bar.",
      "Old name: Beschreibung · New name: description.",
      "If new name already has a value: Skip (keep both, leave conflicting notes alone) or Merge (combine into list) or Overwrite.",
      "Preview, Apply rule. The old name is deleted, the value is written under the new name.",
    ],
  },
  {
    title: "Copy values into another property (keep source)",
    goal: "Example: write moc = value-of-Thema while keeping Thema intact.",
    steps: [
      "Click Copy in the THEN bar.",
      "Source properties: add Thema · Target property: moc.",
      "Tick Wrap as wikilink if you want [[Reise]] instead of plain Reise.",
      "Preview, Apply rule. Thema stays, moc gets the same value.",
    ],
  },
  {
    title: "Merge legacy properties into one canonical name",
    goal: "Example: collapse Beschreibung, Description, descr into description.",
    steps: [
      "Click Merge in the THEN bar.",
      "Properties to merge: add each legacy name + Enter so they appear as chips · Target property: description.",
      "If target exists: Merge into list to keep both old and new values.",
      "Preview, Apply rule. The legacy properties are deleted, their values land under description.",
    ],
  },
  {
    title: "Delete a property entirely",
    goal: "Example: remove tags-old from every matched note.",
    steps: [
      "Click Delete properties in the THEN bar (or right-click the column header → Delete property ...).",
      "Add tags-old to the list (chips). You can add several legacy keys at once.",
      "Apply rule. Each listed property is removed (key + value) from every matched note.",
    ],
  },
  {
    title: "Undo any action",
    goal: "Every Apply writes a JSON snapshot to the plugin data folder (plugins/frontmatter-operator/snapshots/).",
    steps: [
      "Right after the action, the Apply notice carries an Undo button for 12 seconds.",
      "If you missed it, click Undo last in the toolbar (top right).",
      "Older actions are reachable via Snapshot history in the toolbar.",
      "Restore reverts the affected notes to their exact previous frontmatter.",
    ],
  },
];

export class HelpModal extends DraggableModal {
  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal-content");
    titleEl.setText("How to use this plugin");

    contentEl.createDiv({
      cls: "fm-editor-help-intro",
      text: "A rule is the combination of WHEN (filter conditions in the bar above the table or in column header rows) and THEN (the bulk action you trigger from the footer). Targets default to all matched notes; tick rows in the table to scope the action down. Every Apply rule writes a snapshot for undo.",
    });

    const list = contentEl.createDiv({ cls: "fm-editor-help-list" });
    for (const r of RECIPES) {
      const card = list.createDiv({ cls: "fm-editor-help-card" });
      card.createEl("h3", { text: r.title });
      card.createEl("p", { text: r.goal, cls: "fm-editor-help-goal" });
      const ol = card.createEl("ol");
      for (const step of r.steps) {
        ol.createEl("li", { text: step });
      }
    }

    const footer = contentEl.createDiv({ cls: "fm-editor-modal-footer" });
    const right = footer.createDiv({ cls: "fm-editor-modal-footer-right" });
    const close = right.createEl("button", {
      text: "Close",
      cls: "fm-editor-btn mod-cta",
    });
    close.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
