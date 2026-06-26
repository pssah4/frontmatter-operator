# Frontmatter Editor

Obsidian plugin for bulk-editing frontmatter (YAML properties) across the whole vault.

Filter notes by any combination of property/value conditions, preview the diff, then apply: set, delete, rename, copy or move values. Every action writes a JSON snapshot under `.frontmatter-editor/snapshots/` so you can undo.

## Use cases

- "Add `type: person` to every note where `Kategorie == Person`."
- "Delete the legacy `tags-old` property everywhere."
- "Rename `Beschreibung` to `description`, keep wikilink values intact."
- "Merge `aliases-de` and `aliases-en` into `aliases`."

## Install (local)

```bash
npm install
cp .env.example .env   # set PLUGIN_DIR to .obsidian/plugins/frontmatter-editor in your vault
npm run deploy
```

Then enable "Frontmatter Editor" in Obsidian's Community Plugins settings and run the **Open Frontmatter Editor** command.

## Develop

```bash
npm run dev      # watch mode
npm run test     # vitest
npm run build    # production bundle
```

## Architecture

- `src/services/FrontmatterScanner.ts` -- walks `vault.getMarkdownFiles()`, reads frontmatter via `metadataCache`.
- `src/services/FilterEngine.ts` -- pure multi-filter evaluation (AND/OR, regex, list-aware).
- `src/services/BulkActionService.ts` -- pure `applyActionPure()` for previews, real writes via `app.fileManager.processFrontMatter()`.
- `src/services/SnapshotService.ts` -- JSON snapshots under `.frontmatter-editor/snapshots/`, capped at 50.
- `src/ui/FrontmatterEditorView.ts` -- `ItemView` with property inventory, filter chips, results table, action bar.

All vault operations go through Obsidian APIs that are also available inside the Vault Operator sandbox, so the action logic can later be lifted into a Vault Operator skill without changing the core.
