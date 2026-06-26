# Frontmatter Editor

Obsidian plugin for bulk-editing YAML frontmatter (properties) across the whole vault.

Filter notes by any combination of property/value conditions or per-column quick filters, preview the diff, then apply one of five bulk actions: **set**, **delete**, **rename**, **copy** or **merge**. Every action writes a JSON snapshot under `.frontmatter-editor/snapshots/` so any change can be undone.

The plugin exposes a typed **programmatic API** and a stable set of **commands**, so it can be driven from another plugin (e.g. **Vault Operator**), a Templater script, a workflow, or the command palette without touching the UI.

---

## Quickstart (UI)

1. Open the **Frontmatter Editor** command from the palette (or click the `table` ribbon icon).
2. **WHEN** — add filter conditions in the bar above the table, or type into a column's filter row inline. Conditions and column filters combine with AND.
3. **MATCHED** — the result count updates live in the table toolbar and in the flow rail on the left.
4. **THEN** — click one of the five action buttons in the footer: Set property, Rename, Copy, Merge, Delete properties.
5. **Apply** — every action writes a snapshot. The Apply notice carries an Undo button for 12 seconds; the toolbar's Undo last button restores the latest snapshot anytime.

---

## Action catalog

The plugin exposes the following bulk actions. Each action exists in three forms:

- **UI**: a footer button + a modal.
- **Command** (`commandId` below): invocable via the Obsidian command palette and via `app.commands.executeCommandById(...)`.
- **API method** (`apiMethod` below): synchronous programmatic call returning an `ActionResult`.

| Action | Command id | API method | What it does | Destructive | Snapshot |
|---|---|---|---|---|---|
| Set property | `frontmatter-editor:set-property` | `setProperty(opts)` | Writes a value (literal, list, wikilink, or per-note template `{{Other}}`) into a property. | no | yes |
| Delete properties | `frontmatter-editor:delete-properties` | `deleteProperties(opts)` | Removes one or more properties (key + value) entirely. | yes | yes |
| Rename property | `frontmatter-editor:rename-property` | `renameProperty(opts)` | Changes a property's name without altering its value. | yes | yes |
| Copy property | `frontmatter-editor:copy-property` | `copyProperty(opts)` | Copies values from one or more sources into a target; sources kept. | no | yes |
| Merge properties | `frontmatter-editor:merge-properties` | `mergeProperties(opts)` | Combines values from multiple sources into one target; sources deleted. | yes | yes |
| Undo last | `frontmatter-editor:undo-last` | `undoLast()` | Restores the most recent snapshot. | no | no |
| List properties | `frontmatter-editor:list-properties` | `listProperties()` | Returns every property in the vault with usage count, types and samples. | no | no |
| Open snapshots | `frontmatter-editor:open-snapshots` | `listSnapshots()` | Opens the snapshot manager (UI) / returns the snapshot list (API). | no | no |

`api.describeActions()` returns the full machine-readable catalog, including each parameter, its type, whether it is required, and a runnable example. Use it when wiring this plugin into a skill catalog or schema-validated tool layer.

---

## Programmatic API

The API is mounted on the plugin instance:

```ts
const fm = app.plugins.plugins["frontmatter-editor"].api;
```

### Selecting notes

Every mutating method takes a `select: NoteSelector` describing which notes the action targets.

```ts
type NoteSelector =
  | { kind: "all" }
  | { kind: "paths"; paths: string[] }
  | {
      kind: "filter";
      conditions: Array<{
        property: string;
        operator:
          | "exists" | "not_exists"
          | "equals" | "not_equals"
          | "contains" | "not_contains"
          | "starts_with" | "ends_with"
          | "matches_regex"
          | "is_empty" | "is_not_empty"
          | "is_list" | "is_string"
          | "in_path";
        value?: string;
        caseSensitive?: boolean;
      }>;
      combinator?: "AND" | "OR"; // default AND
    };
```

### Set property

```ts
await fm.setProperty({
  select: {
    kind: "filter",
    conditions: [
      { property: "Thema", operator: "equals", value: "Reise" },
    ],
  },
  property: "moc",
  value: "[[Reise]]",
  mode: "overwrite", // or "skip_if_exists" or "merge_list"
});
```

Per-note template (resolves `{{Thema}}` against each note's frontmatter):

```ts
await fm.setProperty({
  select: { kind: "filter", conditions: [{ property: "Thema", operator: "is_not_empty" }] },
  property: "moc",
  value: "{{Thema}}",
  template: true,
  wrapWikilink: true,
});
```

### Delete properties

```ts
await fm.deleteProperties({
  select: { kind: "all" },
  properties: ["tags-old", "legacy-id"],
});
```

### Rename property

```ts
await fm.renameProperty({
  select: { kind: "all" },
  fromProperty: "Beschreibung",
  toProperty: "description",
  onConflict: "skip", // or "overwrite" or "merge_list"
});
```

### Copy property

```ts
await fm.copyProperty({
  select: { kind: "filter", conditions: [{ property: "Thema", operator: "is_not_empty" }] },
  fromProperties: ["Thema"],
  toProperty: "moc",
});
```

### Merge properties

```ts
await fm.mergeProperties({
  select: { kind: "all" },
  fromProperties: ["Beschreibung", "Description", "descr"],
  toProperty: "description",
  onConflict: "merge_list",
});
```

### Undo

```ts
const undone = await fm.undoLast();
// or restore by id:
await fm.restoreSnapshot("20260626-225512-x9k2");
```

### Inspect

```ts
const scan = await fm.scan();
// { totalNotes, notesWithFrontmatter, properties: [{ name, count, sampleValues, types }, ...] }

const targets = await fm.resolveTargets({
  kind: "filter",
  conditions: [{ property: "Kategorie", operator: "equals", value: "Person" }],
});
// returns TFile[]

const catalog = fm.describeActions();
// machine-readable action catalog for skill-discovery layers
```

### Return value

Mutating methods return an `ActionResult`:

```ts
interface ActionResult {
  successCount: number;
  skippedCount: number;
  errorCount: number;
  errors: Array<{ path: string; message: string }>;
  snapshotId?: string;
}
```

---

## Vault Operator integration

This plugin is designed to be picked up by **Vault Operator**'s plugin scanner and turned into a **community plugin skill**. Vault Operator can discover the plugin via:

1. **Manifest** (`manifest.json`): declares the plugin id, name, and a one-paragraph description listing the eight commands.
2. **Commands**: registered with descriptive names like *"Set frontmatter property on filtered notes..."* — discoverable via `app.commands.commands`.
3. **API catalog**: `api.describeActions()` returns a fully typed JSON schema of every action with its parameters, examples, destructive/snapshot flags. This is the source of truth a scanner should use to build a skill descriptor.
4. **README**: this document, with copy-pasteable code samples for every action.

Recommended skill mapping:

| Skill | Calls | Args |
|---|---|---|
| `frontmatter.set` | `api.setProperty(opts)` | `select, property, value, mode?, template?, wrapWikilink?` |
| `frontmatter.delete` | `api.deleteProperties(opts)` | `select, properties` |
| `frontmatter.rename` | `api.renameProperty(opts)` | `select, fromProperty, toProperty, onConflict?, wrapWikilink?` |
| `frontmatter.copy` | `api.copyProperty(opts)` | `select, fromProperties, toProperty, onConflict?, wrapWikilink?` |
| `frontmatter.merge` | `api.mergeProperties(opts)` | `select, fromProperties, toProperty, onConflict?, wrapWikilink?` |
| `frontmatter.undo` | `api.undoLast()` | none |
| `frontmatter.list` | `api.listProperties()` | none |

All mutating skills are snapshot-safe; the agent can always recover by calling `frontmatter.undo`.

---

## Install (local)

```bash
npm install
cp .env.example .env   # set PLUGIN_DIR to .obsidian/plugins/frontmatter-editor in your vault
npm run deploy
```

Then enable **Frontmatter Editor** in Obsidian's Community Plugins settings and run the **Open Frontmatter Editor** command.

## Develop

```bash
npm run dev      # watch mode
npm run test     # vitest (50 tests covering FilterEngine, BulkAction, ValueCoercion)
npm run build    # production bundle
```

## Architecture

- `src/services/FrontmatterScanner.ts` — walks `vault.getMarkdownFiles()`, reads frontmatter via `metadataCache`, also exposes property-value vocabulary.
- `src/services/FilterEngine.ts` — pure multi-filter evaluation (AND/OR, regex, list-aware, case-sensitive).
- `src/services/BulkActionService.ts` — pure `applyActionPure()` for previews; real writes via `app.fileManager.processFrontMatter()`. Supports multi-source rename/copy/merge, multi-property delete, per-note templating, wikilink coercion.
- `src/services/SnapshotService.ts` — JSON snapshots under `.frontmatter-editor/snapshots/` with 50-snapshot rolling retention.
- `src/api/FrontmatterEditorAPI.ts` — public, stable surface for programmatic callers. Includes `describeActions()` for skill catalog discovery.
- `src/ui/FrontmatterEditorView.ts` — `ItemView` with the flow rail, WHEN bar, table (sticky sortable headers + per-column filter row), THEN action bar.
- `src/ui/modals/*` — one focused modal per action (Set / Delete / Rename / Copy / Merge / Snapshots / Help).

All vault operations go through Obsidian APIs that are also available inside the Vault Operator sandbox, so the action layer can be lifted into a Vault Operator skill without rewriting.
