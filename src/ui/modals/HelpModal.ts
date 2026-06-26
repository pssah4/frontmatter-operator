import { App, Modal } from "obsidian";

interface Recipe {
  title: string;
  goal: string;
  steps: string[];
}

const RECIPES: Recipe[] = [
  {
    title: "Add a property to every note",
    goal: "Example: write `type: note` into every note.",
    steps: [
      "Filters bar: leave empty (no filters = every note).",
      'Do not tick any rows in the table (empty selection = "all filtered").',
      "Click `Set property...`",
      "Property: `type`, Value: `note`, Type: `auto`, On conflict: `overwrite` (or `skip_if_exists` if you only want to fill gaps).",
      "Click `Preview changes`, then `Apply`.",
    ],
  },
  {
    title: "Rule-based set: if Thema = Reise then moc = Reise",
    goal: "Example: tag every travel note with a Map of Content reference.",
    steps: [
      "Filters: + Filter → Property `Thema`, Operator `equals`, Value `Reise`. The badge shows how many notes match.",
      "Click `Set property...`",
      "Property: `moc`, Value: `Reise`, Type: `auto`.",
      "Preview, Apply. Snapshot is saved for undo.",
    ],
  },
  {
    title: "Copy values across properties (per note)",
    goal: "Example: set `moc` to the value of `Thema` on every note.",
    steps: [
      "Filters: optional `Thema is not empty` to skip notes without a Thema.",
      "Click `Set property...`",
      "Property: `moc`, Type: `template`, Value: `{{Thema}}`.",
      "The chip list below shows all available properties — click one to insert its `{{name}}` reference.",
      "Preview shows the resolved value per note. Apply.",
    ],
  },
  {
    title: "Combine multiple property values",
    goal: "Example: build `display = Vorname Nachname`.",
    steps: [
      "Click `Set property...`",
      "Property: `display`, Type: `template`, Value: `{{Vorname}} {{Nachname}}`.",
      "Each note gets its own resolved string.",
    ],
  },
  {
    title: "Rename Beschreibung to description (keeping wikilinks)",
    goal: "Example: migrate a property to a new name without touching values.",
    steps: [
      "Click `Rename / Copy / Move...`",
      "Action: `rename`, From: `Beschreibung`, To: `description`, On conflict: `skip` (or `merge_list` if both already exist).",
      "Preview, Apply.",
    ],
  },
  {
    title: "Bulk-delete a legacy property",
    goal: "Example: remove `tags-old` from the entire vault.",
    steps: [
      "Optional: filter `tags-old is not empty` to inspect first.",
      "Click `Delete property...`",
      "Property: `tags-old`, Apply.",
    ],
  },
  {
    title: "Undo any action",
    goal: "Every Apply writes a JSON snapshot to .frontmatter-editor/snapshots/.",
    steps: [
      "Header → `Snapshots`.",
      "Pick the snapshot for the action you want to revert.",
      "Click `Restore` — affected notes go back to their previous frontmatter exactly.",
    ],
  },
];

export class HelpModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-editor-modal");
    contentEl.createEl("h2", { text: "How to use Frontmatter Editor" });

    const intro = contentEl.createDiv({ cls: "fm-editor-help-intro" });
    intro.createEl("p", {
      text: "Workflow: filter the notes you want, then run a bulk action. Targets default to all filtered notes; tick rows to scope down. Every action writes a snapshot so you can undo.",
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
    const close = footer.createEl("button", {
      text: "Close",
      cls: "fm-editor-btn fm-editor-btn-primary",
    });
    close.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
