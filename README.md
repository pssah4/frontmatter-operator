# Frontmatter Operator

Obsidian plugin for bulk-editing YAML frontmatter (properties) across an entire vault, and for turning a messy, inconsistent vault into a clean, structured one.

Filter notes by any combination of property and value conditions, preview the result count live, then apply a bulk action: **set**, **delete**, **rename**, **copy**, **merge**, or **rename values**. Generate missing fields with an LLM (description, keywords, map-of-content or any other property). Clean up refusal boilerplate and duplicate wikilinks vault-wide. Every write is snapshotted, so any change can be undone.

The plugin has two faces:

- An **interactive table view** for humans: a spreadsheet over your frontmatter with inline editing, per-column filters, and a WHEN / THEN action bar.
- A typed, self-describing **programmatic API** plus 12 commands, so another plugin, a Templater script, an agent, or the command palette can drive it without touching the UI.

This plugin is optimized to wotk together with the [**Vault Operator**](https://community.obsidian.md/plugins/vault-operator) agent.


---

## What you can do with it


| Capability | Summary |
|---|---|
| Inspect | Scan the whole vault into a property inventory (usage counts, value samples, detected types). Browse and edit it as a live table. |
| Filter | Select notes with 14 operators (`equals`, `contains`, `matches_regex`, `is_empty`, `is_list`, `in_path`, and more), combined with AND / OR, plus virtual columns for folder, filename, and extension. |
| Set | Write a literal, list, wikilink, or per-note template (`{{OtherProperty}}`) into a property. Conflict modes: overwrite, skip if present, or merge into a list. |
| Rename properties | Change a property's key without touching its value. Handle collisions by skip, overwrite, or merge. |
| Copy / Merge | Fold one or more source properties into a target. Copy keeps the sources, merge deletes them. |
| Rename values | Rewrite the values themselves in place: per-value mappings plus bulk transforms (trim, lowercase, titlecase, strip diacritics). |
| Delete | Remove one or more properties in a single pass. |
| Generate with AI | Fill missing `description`, `tags`, `moc`, or any other value from note content using an LLM. Bring your own key, 12 providers, 11 languages, custom prompts. |
| Clean up | Strip LLM refusal text ("I cannot help with...") out of frontmatter, and collapse duplicate or path-form wikilinks to their canonical spelling. |
| Undo | Every write action saves a JSON snapshot. Undo the last action, or restore any of the last 50 from the snapshot history. |

The rest of this document walks through the main use case (migrating a vault to Open Knowledge Format), then documents the UI, the actions, the AI generator, the providers, and the API in detail.

---

## Migrating an existing vault to Open Knowledge Format (OKF)

[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) (OKF) is an open specification published by Google Cloud that formalizes the "LLM wiki" pattern: a directory of Markdown files, each carrying a small YAML frontmatter block plus a Markdown body, that AI agents and tools can consume as curated context. An Obsidian vault is already shaped like an OKF bundle. The gap is usually the frontmatter: keys are inconsistent, the required `type` field is missing, and values are not normalized. That gap is exactly what Frontmatter Operator closes.

### The target shape

OKF v0.1 defines one required field and five recommended ones for every concept document:

| OKF field | Required | Meaning | How Frontmatter Operator gets you there |
|---|---|---|---|
| `type` | yes | Short string naming the kind of concept (`Person`, `Project`, `Meeting`, `Reference`, `Metric`, ...). Non-empty is the one hard conformance rule. | **Set** it on filtered notes, **rename** an existing `Kategorie` / `Typ` / `category` into it, or derive it per folder using the `__folder` virtual column. |
| `title` | recommended | Human-readable display name. | **Set** from a template (`{{Name}}`) or fill from the filename. |
| `description` | recommended | Single-sentence summary. | **Merge** scattered `Beschreibung` / `Description` / `summary` fields into one, or **generate** it with the AI `description` preset. |
| `resource` | recommended | URI identifying the underlying asset. | **Set** a per-note URI, template-driven. |
| `tags` | recommended | YAML list of short strings. | **Rename** / **merge** tag-like fields, **normalize** the values (lowercase, dedup, strip accents), or **generate** them with the AI `keywords` preset. |
| `timestamp` | recommended | ISO 8601 datetime of last change. | **Rename** an existing `created` / `erstellt` / `date` into it. |

Unknown keys are allowed by the spec and are always preserved. You do not have to throw away vault-specific fields to be conformant. You only have to make sure every non-reserved note has a non-empty `type`.

### Before and after

A typical note from a vault that grew organically over years:

```yaml
---
Category: Person
Summary: Collegue from Marketing
Job: works on brand campaigns
tags: [Marketing, marketing, PERSON, Persön]
created: 2024-03-01
topic: "[[People/Team]]"
cluster: "[[Team]]"
---
```

The same note after an OKF migration pass:

```yaml
---
type: Person
description: Colleague from marketing who works on brand campaigns.
tags:
  - marketing
  - person
timestamp: 2024-03-01
moc: "[[Team]]"
---
```

Five bulk actions get you from the first block to the second, run once across the whole vault:

- `Category` renamed to `type` (the one required field).
- `Summary` and `Job` merged into a single `description`.
- `tags` normalized: lowercased, accents stripped, duplicates collapsed, so `[Marketing, marketing, PERSON, Persön]` becomes `[marketing, person]`.
- `created` renamed to `timestamp`.
- `topic` and `cluster` merged into `moc`, then the two spellings of the same link (`[[People/Team]]` and `[[Team]]`) deduplicated to the canonical `[[Team]]`.

You filter, preview the count, apply, and undo if it looks wrong. What is tedious by hand across hundreds of notes is a handful of actions here. The [action catalog](#action-catalog) and [programmatic API](#programmatic-api) below show each one; the [AI generator](#ai-generator) fills `description` and `tags` where no source field exists.

To finish a full OKF bundle you would still add the reserved `index.md` and `log.md` files and make body cross-links bundle-relative. Those live outside frontmatter, so they are outside this plugin. Frontmatter Operator owns the frontmatter layer: a non-empty `type` on every note plus clean, consistent recommended fields.

---

## Quickstart (UI)

1. Open the **Open Frontmatter Operator** command from the palette, or click the `copy-slash` ribbon icon.
2. **WHEN**: add filter conditions in the bar above the table, or type into a column's inline filter row. Conditions combine with AND (switchable to OR).
3. **MATCHED**: the result count updates live in the toolbar and in the flow rail on the left.
4. **THEN**: click an action in the footer: Set, Delete, Rename, Copy, Merge, Rename values, or Generate.
5. **Apply**: every action writes a snapshot. The Apply notice carries an Undo button; the toolbar's Undo restores the latest snapshot at any time.

You can also edit any cell directly: click it to enter edit mode. Lists render as chips (type plus Enter to add, Backspace on empty to remove); booleans as a checkbox; wikilinks unwrap for editing and re-wrap on save. Tick the row checkboxes to scope an action to a hand-picked selection instead of the full filtered set.

---

## Action catalog

Each bulk action exists in three forms: a footer button plus modal in the UI, a command, and an API method that returns an `ActionResult`.

| Action | Command id | API method | What it does | Destructive | Snapshot |
|---|---|---|---|---|---|
| Set property | `frontmatter-operator:set-property` | `setProperty(opts)` | Writes a literal, list, wikilink, or per-note template into a property. | no | yes |
| Delete properties | `frontmatter-operator:delete-properties` | `deleteProperties(opts)` | Removes one or more properties entirely. | yes | yes |
| Rename property | `frontmatter-operator:rename-property` | `renameProperty(opts)` | Changes a property's key without altering its value. | yes | yes |
| Rename values | `frontmatter-operator:rename-values` | `renameValues(opts)` | Rewrites values in place: per-value mappings plus transforms. | yes | yes |
| Copy property | `frontmatter-operator:copy-property` | `copyProperty(opts)` | Copies one or more sources into a target; sources kept. | no | yes |
| Merge properties | `frontmatter-operator:merge-properties` | `mergeProperties(opts)` | Folds sources into a target; sources deleted. | yes | yes |
| Clean refusal text | `frontmatter-operator:cleanup-refusal-tags` | `cleanupRefusalTags(opts?)` | Removes LLM refusal boilerplate from frontmatter. | yes | yes |
| Deduplicate wikilinks | `frontmatter-operator:dedupe-wikilinks` | `dedupeWikilinks(opts?)` | Collapses duplicate and path-form wikilinks to canonical. | yes | yes |
| Undo last | `frontmatter-operator:undo-last` | `undoLast()` | Restores the most recent snapshot. | no | no |
| Open snapshots | `frontmatter-operator:open-snapshots` | `listSnapshots()` | Opens the snapshot manager (UI) / returns the list (API). | no | no |
| List properties | `frontmatter-operator:list-properties` | `listProperties()` | Prints / returns every property with counts, types, samples. | no | no |
| Open editor | `frontmatter-operator:open-frontmatter-operator` | (none) | Opens the table view. | no | no |

`api.describeActions()` returns the full machine-readable catalog: every parameter, its type, whether it is required, and a runnable example. Use it when wiring this plugin into a skill catalog or a schema-validated tool layer.

---

## AI generator

The generator fills missing frontmatter fields from a note's body text using an LLM. It runs from the table view (the **Generate** button in the THEN bar) and its own modal. There is no command or API method for it; it is a UI action so you always see scope and cost before running.

**Built-in presets:**

| Preset | Writes to | Output | Parser |
|---|---|---|---|
| Description | `description` | One-sentence summary, up to 25 words. | single line of text |
| Keywords | `tags` | 3 to 5 lowercase, hyphenated keywords as a YAML list. | string list |
| Map of content | `moc` | 2 to 3 topics plus 2 to 3 concepts, reusing existing vault topics where possible. | topics and concepts block |

**Scope:** run against the matched (filtered) notes, only the ticked rows, or just the active note.

**Conflict modes:** skip if the target already has a non-empty value (default and safest), append to a list, or overwrite.

**Languages:** prompts and the guardrail ship in 11 languages (English, German, French, Spanish, Italian, Russian, Arabic, Chinese, Korean, Japanese, Hindi).

**Custom prompts:** add your own preset in settings, pick a target property and a parser (single line, string list, or topics/concepts), and write the prompt. Interpolation tokens `{{NOTE_BODY}}`, `{{KNOWN_TOPICS}}`, and `{{KNOWN_CONCEPTS}}` are available.

**Reliability:** the generator wraps every request in a guardrail that forbids meta-commentary and instructs the model to emit exactly `UNABLE_TO_GENERATE` on failure, which the plugin turns into a clean skip. Responses that still leak refusal phrasing are caught by the refusal detector and, if any slip into frontmatter, can be swept out later with the refusal-cleanup pass. Long batches are cancellable.

---

## LLM providers

The generator can talk to 12 provider types. Add accounts under **Settings > Providers**; each account discovers its own model list. Credentials are encrypted at rest through the operating system keychain (macOS Keychain, Windows DPAPI, Linux libsecret) and never stored in plaintext.

| Provider | Auth |
|---|---|
| Anthropic | API key (supports extended thinking and prompt caching) |
| OpenAI | API key (supports reasoning effort for o-series models) |
| Google Gemini | API key |
| Ollama | base URL (self-hosted) |
| LM Studio | base URL (self-hosted) |
| OpenRouter | API key |
| Azure OpenAI | API key plus endpoint and API version |
| Custom (OpenAI-compatible) | API key plus base URL |
| GitHub Copilot | OAuth device flow |
| ChatGPT | OAuth (PKCE, Codex backend) |
| Kilo Gateway | device auth or manual token |
| Amazon Bedrock | API key, AWS access keys, or gateway |

Decode parameters are set per run: max tokens, temperature, thinking budget (Anthropic), reasoning effort (OpenAI), and prompt caching.

---

## Programmatic API

The API is mounted on the plugin instance and is stable:

```ts
const fm = app.plugins.plugins["frontmatter-operator"].api;
```

### Selecting notes

Every mutating method takes a `select: NoteSelector`:

```ts
type NoteSelector =
  | { kind: "all" }
  | { kind: "paths"; paths: string[] }
  | {
      kind: "filter";
      conditions: Array<{
        property: string; // real key, or a virtual column: __folder, __filename, __extension
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

The selector is validated at the API boundary, so a malformed shape throws a clear `TypeError` instead of failing downstream.

### Read

```ts
await fm.scan();                 // { totalNotes, notesWithFrontmatter, properties: [...] }
await fm.listProperties();       // properties only, sorted by usage
await fm.resolveTargets(select); // TFile[]
await fm.getMatchingPaths(select); // { count, paths }: plain strings, agent-friendly
await fm.listSnapshots();        // [{ id, createdAt, entries }, ...], newest first
fm.describeActions();            // machine-readable action catalog
```

### Write (all snapshotted)

```ts
await fm.setProperty({
  select: { kind: "filter", conditions: [{ property: "Thema", operator: "equals", value: "Reise" }] },
  property: "moc", value: "[[Reise]]", mode: "overwrite",
});

// per-note template, wikilink-wrapped:
await fm.setProperty({
  select: { kind: "filter", conditions: [{ property: "Thema", operator: "is_not_empty" }] },
  property: "moc", value: "{{Thema}}", template: true, wrapWikilink: true,
});

await fm.deleteProperties({ select: { kind: "all" }, properties: ["tags-old", "legacy-id"] });

await fm.renameProperty({
  select: { kind: "all" }, fromProperty: "Beschreibung", toProperty: "description", onConflict: "merge_list",
});

await fm.copyProperty({
  select: { kind: "all" }, fromProperties: ["Thema"], toProperty: "moc",
});

await fm.mergeProperties({
  select: { kind: "all" }, fromProperties: ["Beschreibung", "Description"], toProperty: "description", onConflict: "merge_list",
});

await fm.renameValues({
  select: { kind: "all" }, property: "tags",
  transforms: ["trim", "lowercase", "strip_diacritics"],
  mappings: [{ from: "n/a", to: "" }],
});

await fm.cleanupRefusalTags({ dryRun: true, scope: "targeted" });
await fm.dedupeWikilinks({ dryRun: true });

await fm.undoLast();
await fm.restoreSnapshot("20260626-225512-x9k2");
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

The cleanup methods return richer reports (`CleanupReport`, `DedupReport`) with per-note detail and per-property counts.

---

## Snapshots and undo

Every write action saves a JSON snapshot of the pre-change frontmatter under `<vault.configDir>/plugins/frontmatter-operator/snapshots/` (the plugin-data folder, kept out of vault sync). Retention is a rolling 50 snapshots. `undoLast()` restores the newest; `restoreSnapshot(id)` restores a specific one; the snapshot history modal (**Open snapshot history**) lets you browse and restore any of them. Snapshots from older locations (the pre-rebrand `plugins/frontmatter-editor/snapshots/` folder and the legacy `.frontmatter-editor/snapshots/` path) are migrated on first write.

---

## Vault Operator integration

This plugin is designed to be picked up by **Vault Operator**'s plugin scanner and exposed as a community-plugin skill. Discovery paths:

1. **Manifest** (`manifest.json`): plugin id, name, and a description listing the API surface and the 12 commands.
2. **Commands**: registered with descriptive names, discoverable via `app.commands.commands`.
3. **API catalog**: `api.describeActions()` returns a fully typed catalog of every action with parameters, examples, and destructive/snapshot flags. This is the source of truth a scanner should build its skill descriptor from.
4. **README**: this document.

All mutating methods are snapshot-safe, so an agent can always recover by calling `undoLast()`. Every vault operation goes through Obsidian APIs that are also available inside the Vault Operator sandbox, so the action layer lifts into a skill without a rewrite.

---

## Install

In Obsidian, open **Settings > Community plugins > Browse**, search for **Frontmatter Operator**, install it, and enable it. Then run **Open Frontmatter Operator** from the command palette or click the `copy-slash` ribbon icon.

## Develop

```bash
npm install
npm run dev      # watch build
npm run test     # vitest
npm run build    # production bundle (type-check + esbuild)
```

## Architecture

- `src/services/FrontmatterScanner.ts`: walks `vault.getMarkdownFiles()`, reads frontmatter via `metadataCache`, and builds the property inventory and table rows.
- `src/services/FilterEngine.ts`: pure multi-filter evaluation (AND / OR, 14 operators, regex with a ReDoS guard, virtual-column aware).
- `src/services/BulkActionService.ts`: pure `applyActionPure()` for previews; real writes via `app.fileManager.processFrontMatter()`. Handles set, delete, rename, copy/merge, and value mapping, with a prototype-pollution guard.
- `src/services/ValueMappingEngine.ts`: the transform-and-map pipeline behind rename values (trim, lowercase, titlecase, strip diacritics, plus per-value rewrites, wikilink-aware).
- `src/services/VirtualProperties.ts`: read-only derived columns (`__folder`, `__filename`, `__extension`) for filtering and sorting without adding frontmatter.
- `src/services/RefusalTagCleanupService.ts` and `src/services/WikilinkDedup*.ts`: the two vault-wide cleanup passes.
- `src/services/generator/GeneratorService.ts`: the LLM generator pipeline (read body, interpolate prompt, call provider, parse deterministically, write with conflict handling).
- `src/api/providers/*` and `src/api/ProviderRegistry.ts`: the 12 provider handlers behind a single `ApiHandler` interface.
- `src/auth/*`: OAuth flows (GitHub Copilot, ChatGPT, Kilo) and credential encryption through the OS keychain.
- `src/services/SnapshotService.ts`: JSON snapshots with rolling retention and legacy migration.
- `src/api/FrontmatterEditorAPI.ts`: the public, stable surface, including `describeActions()`.
- `src/ui/FrontmatterEditorView.ts`: the table view (flow rail, WHEN bar, sortable filterable table, THEN action bar), with inline cell editing and live refresh.
- `src/ui/modals/*` and `src/ui/settings/*`: one focused modal per action, plus the provider and prompt settings.
