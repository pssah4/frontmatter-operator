import type { App, TFile } from "obsidian";
import type { FrontmatterScanner } from "../services/FrontmatterScanner";
import type { SnapshotService } from "../services/SnapshotService";
import type { BulkActionService } from "../services/BulkActionService";
import type {
  ActionResult,
  Filter,
  FilterCombinator,
  FilterOperator,
  FmValue,
  NoteRow,
  PropertyStat,
  ScanResult,
  ValueMapping,
  ValueTransform,
} from "../types";
import { applyFilters, evaluateFilter } from "../services/FilterEngine";
import { FILTER_OPERATORS } from "../types";
import type { CleanupReport } from "../services/RefusalTagCleanupService";
import type { DedupReport } from "../services/WikilinkDedupCleanupService";

export type NoteSelector =
  | { kind: "all" }
  | { kind: "paths"; paths: string[] }
  | { kind: "filter"; conditions: FilterSpec[]; combinator?: FilterCombinator };

export interface FilterSpec {
  property: string;
  operator: FilterOperator;
  value?: string;
  caseSensitive?: boolean;
}

export interface SetPropertyOpts {
  select: NoteSelector;
  property: string;
  value: FmValue;
  mode?: "overwrite" | "skip_if_exists" | "merge_list";
  template?: boolean;
  wrapWikilink?: boolean;
}

export interface DeletePropertiesOpts {
  select: NoteSelector;
  properties: string[];
}

export interface RenamePropertyOpts {
  select: NoteSelector;
  fromProperty: string;
  toProperty: string;
  onConflict?: "skip" | "overwrite" | "merge_list";
  wrapWikilink?: boolean;
}

export interface CopyPropertyOpts {
  select: NoteSelector;
  fromProperties: string[];
  toProperty: string;
  onConflict?: "skip" | "overwrite" | "merge_list";
  wrapWikilink?: boolean;
}

export interface MergePropertiesOpts {
  select: NoteSelector;
  fromProperties: string[];
  toProperty: string;
  onConflict?: "skip" | "overwrite" | "merge_list";
  wrapWikilink?: boolean;
}

export interface RenameValuesOpts {
  select: NoteSelector;
  /** The property whose values are rewritten in place. */
  property: string;
  /** Per-value rewrites. `from` is matched AFTER `transforms` are applied;
   *  an empty `to` drops the value (list elements are removed). */
  mappings?: Array<{ from: string; to: string }>;
  /** Bulk transforms applied to each value before the mappings. */
  transforms?: ValueTransform[];
}

let filterIdCounter = 0;
function nextFilterId(): string {
  filterIdCounter += 1;
  return `api-${filterIdCounter}`;
}

function specToFilter(spec: FilterSpec): Filter {
  return {
    id: nextFilterId(),
    property: spec.property,
    operator: spec.operator,
    value: spec.value,
    caseSensitive: spec.caseSensitive,
  };
}

/**
 * HARD-06: validate a NoteSelector at the API boundary so external callers
 * (other plugins, Templater scripts, MCP tools) get a clear error instead of
 * a downstream crash when they pass a malformed shape.
 *
 * Throws TypeError with a human-readable message on the first violation.
 */
export function validateNoteSelector(input: unknown): NoteSelector {
  if (!input || typeof input !== "object") {
    throw new TypeError("NoteSelector must be an object");
  }
  const s = input as Record<string, unknown>;
  if (s.kind === "all") {
    return { kind: "all" };
  }
  if (s.kind === "paths") {
    if (!Array.isArray(s.paths)) {
      throw new TypeError(
        'NoteSelector kind="paths" requires `paths: string[]`',
      );
    }
    for (const p of s.paths) {
      if (typeof p !== "string" || p.length === 0) {
        throw new TypeError(
          "NoteSelector.paths entries must be non-empty strings",
        );
      }
    }
    return { kind: "paths", paths: s.paths as string[] };
  }
  if (s.kind === "filter") {
    if (!Array.isArray(s.conditions)) {
      throw new TypeError(
        'NoteSelector kind="filter" requires `conditions: FilterSpec[]`',
      );
    }
    const conditions: FilterSpec[] = [];
    for (const cRaw of s.conditions) {
      if (!cRaw || typeof cRaw !== "object") {
        throw new TypeError("NoteSelector.conditions entries must be objects");
      }
      const c = cRaw as Record<string, unknown>;
      if (typeof c.property !== "string") {
        throw new TypeError("FilterSpec.property must be a string");
      }
      if (
        typeof c.operator !== "string" ||
        !(FILTER_OPERATORS as readonly string[]).includes(c.operator)
      ) {
        throw new TypeError(
          `FilterSpec.operator must be one of: ${FILTER_OPERATORS.join(", ")}`,
        );
      }
      if (c.value !== undefined && typeof c.value !== "string") {
        throw new TypeError("FilterSpec.value, when present, must be a string");
      }
      if (c.caseSensitive !== undefined && typeof c.caseSensitive !== "boolean") {
        throw new TypeError("FilterSpec.caseSensitive must be a boolean");
      }
      conditions.push({
        property: c.property,
        operator: c.operator as FilterSpec["operator"],
        value: c.value as string | undefined,
        caseSensitive: c.caseSensitive as boolean | undefined,
      });
    }
    const combinator = s.combinator;
    if (
      combinator !== undefined &&
      combinator !== "AND" &&
      combinator !== "OR"
    ) {
      throw new TypeError('NoteSelector.combinator must be "AND" or "OR"');
    }
    return {
      kind: "filter",
      conditions,
      combinator: combinator as FilterCombinator | undefined,
    };
  }
  throw new TypeError(
    'NoteSelector.kind must be "all", "paths", or "filter"',
  );
}

/**
 * Public, stable surface of the Frontmatter Operator plugin.
 *
 * Exposed as `app.plugins.plugins["frontmatter-operator"].api`.
 *
 * Every mutating method writes a JSON snapshot under
 * `<vault.configDir>/plugins/frontmatter-operator/snapshots/{id}.json`
 * (default `.obsidian/plugins/...`, kept out of vault sync) and returns the
 * snapshot id so the caller can restore via {@link FrontmatterEditorAPI.restoreSnapshot}
 * or {@link FrontmatterEditorAPI.undoLast}.
 *
 * Trust model (M-2, AUDIT 2026-07-01): this surface is intentionally
 * unauthenticated -- any plugin in the vault can call it, including the
 * destructive write methods. That is by design and adds no attack surface
 * beyond Obsidian's own model, where any installed plugin already has full
 * `Vault`/`TFile` write access. The defenses that DO apply on every call are:
 * strict selector validation ({@link validateNoteSelector}), the
 * prototype-pollution key guard (`isAllowedKey`), and a mandatory,
 * user-restorable snapshot before each mutation. There is deliberately no
 * cross-plugin allowlist; adding one would give a false sense of a boundary
 * that Obsidian does not enforce at the plugin layer.
 */
export class FrontmatterEditorAPI {
  /** Stable API contract version. Bumped on breaking changes. */
  readonly version = "1.2.0";

  /**
   * The single source of truth for the agent-callable surface. Drives two
   * things: (1) the own-enumerable binding in the constructor below, and
   * (2) the discovery-contract tests that mirror Vault Operator's two
   * reflection strategies. Keep in sync with {@link ACTION_CATALOG}.
   */
  static readonly PUBLIC_METHODS = [
    // read
    "scan",
    "listProperties",
    "getMatchingPaths",
    "resolveTargets",
    "listSnapshots",
    "describeActions",
    // write (snapshotted, undoable)
    "setProperty",
    "deleteProperties",
    "renameProperty",
    "renameValues",
    "copyProperty",
    "mergeProperties",
    "cleanupRefusalTags",
    "dedupeWikilinks",
    "undoLast",
    "restoreSnapshot",
  ] as const;

  constructor(
    private readonly app: App,
    private readonly scanner: FrontmatterScanner,
    private readonly bulk: BulkActionService,
    private readonly snapshots: SnapshotService,
  ) {
    // Vault Operator discovers our API two ways: its VaultDNAScanner walks
    // the prototype chain (sees class methods), but its probe_plugin
    // live-probe (ADR-124) reads Object.keys (own enumerable props only).
    // A plain class instance is invisible to the second path. Binding each
    // public method as an own enumerable property makes both paths agree
    // without sacrificing the class for typed solo usage.
    for (const name of FrontmatterEditorAPI.PUBLIC_METHODS) {
      const self = this as unknown as Record<string, unknown>;
      const fn = self[name];
      if (typeof fn === "function") {
        self[name] = (fn as (...args: unknown[]) => unknown).bind(this);
      }
    }
  }

  /** Scan the vault and return a property inventory. */
  async scan(): Promise<ScanResult> {
    return this.scanner.scan();
  }

  /** List all frontmatter properties in the vault, sorted by usage count. */
  async listProperties(): Promise<PropertyStat[]> {
    return this.scanner.scan().properties;
  }

  /**
   * Resolve a NoteSelector into the concrete set of TFile-backed rows the
   * action will run on. Useful for previewing how many notes a rule would hit
   * without writing anything.
   */
  async resolveTargets(select: NoteSelector): Promise<TFile[]> {
    const rows = await this._selectorToRows(select);
    return rows.map((r) => r.file);
  }

  /**
   * Resolve a NoteSelector into the matching note paths plus a count.
   *
   * Agent-friendly companion to {@link resolveTargets}: returns plain
   * strings that serialise cleanly across the Vault Operator
   * `call_plugin_api` bridge, where the heavyweight (and partly circular)
   * `TFile[]` from resolveTargets would be truncated. Use this to preview
   * how many notes a rule hits before writing anything.
   */
  async getMatchingPaths(
    select: NoteSelector,
  ): Promise<{ count: number; paths: string[] }> {
    const rows = await this._selectorToRows(select);
    const paths = rows.map((r) => r.path);
    return { count: paths.length, paths };
  }

  /**
   * Set a frontmatter property on every selected note.
   *
   * Use `template: true` together with a value like `"{{Thema}}"` to copy a
   * per-note value from another property. Single-substitution preserves the
   * source type (lists stay lists); multi-substitution produces a string.
   *
   * Set `wrapWikilink: true` to coerce the resolved value to `[[wikilink]]`
   * form before writing.
   */
  async setProperty(opts: SetPropertyOpts): Promise<ActionResult> {
    const rows = await this._selectorToRows(opts.select);
    return this.bulk.executeAction(rows, {
      type: "set",
      property: opts.property,
      value: opts.value,
      mode: opts.mode ?? "overwrite",
      template: opts.template,
      wrapWikilink: opts.wrapWikilink,
    });
  }

  /**
   * Delete one or more frontmatter properties (key + value) from every
   * selected note.
   */
  async deleteProperties(opts: DeletePropertiesOpts): Promise<ActionResult> {
    const rows = await this._selectorToRows(opts.select);
    return this.bulk.executeAction(rows, {
      type: "delete",
      properties: opts.properties,
    });
  }

  /**
   * Rename a single frontmatter property. The source key is deleted, the
   * value lives on under `toProperty`.
   */
  async renameProperty(opts: RenamePropertyOpts): Promise<ActionResult> {
    const rows = await this._selectorToRows(opts.select);
    return this.bulk.executeAction(rows, {
      type: "rename",
      fromProperties: [opts.fromProperty],
      toProperty: opts.toProperty,
      onConflict: opts.onConflict ?? "skip",
      wrapWikilink: opts.wrapWikilink,
    });
  }

  /**
   * Copy values from one or more source properties into a target. Sources
   * are kept intact. Multi-source copies merge (list-style, deduped).
   */
  async copyProperty(opts: CopyPropertyOpts): Promise<ActionResult> {
    const rows = await this._selectorToRows(opts.select);
    return this.bulk.executeAction(rows, {
      type: "copy",
      fromProperties: opts.fromProperties,
      toProperty: opts.toProperty,
      onConflict: opts.onConflict ?? "skip",
      wrapWikilink: opts.wrapWikilink,
    });
  }

  /**
   * Merge values from multiple source properties into one target property
   * and DELETE the sources afterwards. Use this for consolidating legacy keys
   * such as `Beschreibung + Description + descr -> description`.
   */
  async mergeProperties(opts: MergePropertiesOpts): Promise<ActionResult> {
    const rows = await this._selectorToRows(opts.select);
    return this.bulk.executeAction(rows, {
      type: "move",
      fromProperties: opts.fromProperties,
      toProperty: opts.toProperty,
      onConflict: opts.onConflict ?? "merge_list",
      wrapWikilink: opts.wrapWikilink,
    });
  }

  /**
   * Batch-rename the VALUES of a single property in place (keys stay). For
   * example map `Interview -> interview` across every selected note, or
   * lowercase all values via `transforms: ["lowercase"]`. Wikilink wrapping is
   * preserved; an empty `to` drops the value. Only notes whose value actually
   * changes are written. Snapshotted and undoable.
   */
  async renameValues(opts: RenameValuesOpts): Promise<ActionResult> {
    const rows = await this._selectorToRows(opts.select);
    const valueMappings: ValueMapping[] = (opts.mappings ?? []).map((m) => ({
      source: m.from,
      target: m.to,
      userEdited: true,
    }));
    return this.bulk.executeAction(rows, {
      type: "map_values",
      property: opts.property,
      transforms: opts.transforms ?? [],
      valueMappings,
    });
  }

  /**
   * Remove refusal text (LLM "I cannot..." boilerplate) from frontmatter
   * across the vault and return a structured report. Unlike the
   * `cleanup-refusal-tags` command, this never opens a confirmation dialog,
   * so it is safe to drive from an agent. Pass `dryRun: true` to preview.
   *
   * The run is snapshotted, so a real run is reversible via {@link undoLast}.
   * `scope` defaults to the curated generator-target property set; pass
   * `"all"` to scan every non-reserved key.
   */
  async cleanupRefusalTags(
    opts: { dryRun?: boolean; scope?: "targeted" | "all"; property?: string } = {},
  ): Promise<CleanupReport> {
    const { RefusalTagCleanupService } = await import(
      "../services/RefusalTagCleanupService"
    );
    const service = new RefusalTagCleanupService(this.app, this.snapshots);
    return service.run({
      dryRun: opts.dryRun ?? false,
      scope: opts.scope,
      property: opts.property,
    });
  }

  /**
   * Collapse frontmatter wikilinks that resolve to the same note and
   * shorten lone path-form links to Obsidian's canonical form. Returns a
   * structured report. Like {@link cleanupRefusalTags}, this skips the
   * confirmation dialog of the `dedupe-wikilinks` command and is
   * snapshotted (reversible via {@link undoLast}). Pass `dryRun: true` to
   * preview, or `paths` to restrict the scan to specific notes.
   */
  async dedupeWikilinks(
    opts: { dryRun?: boolean; paths?: string[]; property?: string } = {},
  ): Promise<DedupReport> {
    const { WikilinkDedupCleanupService } = await import(
      "../services/WikilinkDedupCleanupService"
    );
    const service = new WikilinkDedupCleanupService(this.app, this.snapshots);
    return service.run({
      dryRun: opts.dryRun ?? false,
      paths: opts.paths,
      property: opts.property,
    });
  }

  /**
   * Undo the most recent action by restoring its snapshot. Returns null if
   * no snapshot exists.
   */
  async undoLast(): Promise<ActionResult | null> {
    const snaps = await this.snapshots.list();
    if (snaps.length === 0) return null;
    return this.bulk.restoreSnapshot(snaps[0]);
  }

  /** Restore a specific snapshot by id. */
  async restoreSnapshot(id: string): Promise<ActionResult | null> {
    const snap = await this.snapshots.get(id);
    if (!snap) return null;
    return this.bulk.restoreSnapshot(snap);
  }

  /** List snapshots, newest first. */
  async listSnapshots(): Promise<
    Array<{ id: string; createdAt: string; entries: number }>
  > {
    const snaps = await this.snapshots.list();
    return snaps.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      entries: s.entries.length,
    }));
  }

  /**
   * Catalog of all actions this plugin exposes. Returned as plain JSON so a
   * scanner can build a Skill descriptor without parsing source code.
   */
  describeActions(): ActionCatalog {
    return ACTION_CATALOG;
  }

  private async _selectorToRows(select: NoteSelector): Promise<NoteRow[]> {
    const validated = validateNoteSelector(select);
    const all = this.scanner.buildAllRows();
    if (validated.kind === "all") return all;
    if (validated.kind === "paths") {
      const set = new Set(validated.paths);
      return all.filter((r) => set.has(r.path));
    }
    const filters = validated.conditions.map(specToFilter);
    const combinator = validated.combinator ?? "AND";
    const filtered = applyFilters(all, filters, combinator);
    if (combinator === "AND") return filtered;
    return filtered;
  }
}

export interface ActionCatalog {
  pluginId: string;
  pluginName: string;
  version: string;
  description: string;
  actions: ActionDescriptor[];
}

export interface ActionDescriptor {
  id: string;
  name: string;
  commandId: string;
  apiMethod: string;
  description: string;
  parameters: ActionParameter[];
  example: string;
  destructive: boolean;
  snapshotted: boolean;
}

export interface ActionParameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

const SELECT_PARAMETER: ActionParameter = {
  name: "select",
  type:
    '{ kind: "all" } | { kind: "paths", paths: string[] } | { kind: "filter", conditions: FilterSpec[], combinator?: "AND" | "OR" }',
  required: true,
  description:
    "Which notes the action targets. `all` = every markdown note in the vault. `paths` = explicit note paths. `filter` = a list of property/operator/value conditions combined with AND or OR.",
};

const ACTION_CATALOG: ActionCatalog = {
  pluginId: "frontmatter-operator",
  pluginName: "Frontmatter Operator",
  version: "1.2.0",
  description:
    "Bulk-edit YAML frontmatter across the Obsidian vault. Filter notes by any property condition, then set, delete, rename, copy or merge properties; clean refusal text from tags and collapse duplicate wikilinks. Every write action saves a JSON snapshot and is undo-able. Built for use from a Vault Operator skill: call describeActions for this catalog, getMatchingPaths to preview a selector, and the write methods for parametrised edits.",
  actions: [
    {
      id: "set-property",
      name: "Set frontmatter property",
      commandId: "frontmatter-operator:set-property",
      apiMethod: "setProperty",
      description:
        "Write a value into a frontmatter property on the selected notes. Supports literal values, lists, wikilinks and per-note templates like `{{Thema}}`.",
      parameters: [
        SELECT_PARAMETER,
        {
          name: "property",
          type: "string",
          required: true,
          description: "Property name to set (e.g. `type`).",
        },
        {
          name: "value",
          type: "string | number | boolean | null | string[]",
          required: true,
          description: "Literal value to write, or a template like `{{Thema}}` when template=true.",
        },
        {
          name: "mode",
          type: '"overwrite" | "skip_if_exists" | "merge_list"',
          required: false,
          description:
            "How to handle notes where the property already has a value. Defaults to `overwrite`.",
        },
        {
          name: "template",
          type: "boolean",
          required: false,
          description:
            "If true, treat `value` as a template and resolve `{{otherProperty}}` per note.",
        },
        {
          name: "wrapWikilink",
          type: "boolean",
          required: false,
          description: "Wrap the resolved value as [[wikilink]] if not already.",
        },
      ],
      example:
        'await api.setProperty({ select: { kind: "filter", conditions: [{ property: "Thema", operator: "equals", value: "Reise" }] }, property: "moc", value: "[[Reise]]" })',
      destructive: false,
      snapshotted: true,
    },
    {
      id: "delete-properties",
      name: "Delete frontmatter properties",
      commandId: "frontmatter-operator:delete-properties",
      apiMethod: "deleteProperties",
      description:
        "Remove one or more frontmatter properties (key + value) entirely from each selected note.",
      parameters: [
        SELECT_PARAMETER,
        {
          name: "properties",
          type: "string[]",
          required: true,
          description: "Property names to remove. Multiple keys are deleted in one pass.",
        },
      ],
      example:
        'await api.deleteProperties({ select: { kind: "all" }, properties: ["tags-old", "legacy-id"] })',
      destructive: true,
      snapshotted: true,
    },
    {
      id: "rename-property",
      name: "Rename frontmatter property",
      commandId: "frontmatter-operator:rename-property",
      apiMethod: "renameProperty",
      description:
        "Change the name of a single property without altering its value. The source key is deleted, the value lives on under the new key.",
      parameters: [
        SELECT_PARAMETER,
        {
          name: "fromProperty",
          type: "string",
          required: true,
          description: "Current property name.",
        },
        {
          name: "toProperty",
          type: "string",
          required: true,
          description: "Desired property name.",
        },
        {
          name: "onConflict",
          type: '"skip" | "overwrite" | "merge_list"',
          required: false,
          description:
            "Behavior when the new name already has a value on a note. Defaults to `skip`.",
        },
        {
          name: "wrapWikilink",
          type: "boolean",
          required: false,
          description: "Wrap the renamed value as [[wikilink]].",
        },
      ],
      example:
        'await api.renameProperty({ select: { kind: "all" }, fromProperty: "Beschreibung", toProperty: "description" })',
      destructive: true,
      snapshotted: true,
    },
    {
      id: "rename-values",
      name: "Rename frontmatter values",
      commandId: "frontmatter-operator:rename-values",
      apiMethod: "renameValues",
      description:
        "Rewrite the VALUES of a single property in place (keys stay). Map specific values (e.g. `Interview` -> `interview`), and/or apply bulk transforms (trim, lowercase, titlecase, strip_diacritics). Wikilink wrapping is preserved; an empty target drops the value. Only notes whose value actually changes are written.",
      parameters: [
        SELECT_PARAMETER,
        {
          name: "property",
          type: "string",
          required: true,
          description: "The property whose values are rewritten.",
        },
        {
          name: "mappings",
          type: "Array<{ from: string; to: string }>",
          required: false,
          description:
            "Per-value rewrites. `from` is matched after transforms; empty `to` drops the value.",
        },
        {
          name: "transforms",
          type: '("trim" | "lowercase" | "titlecase" | "strip_diacritics")[]',
          required: false,
          description: "Bulk transforms applied to each value before the mappings.",
        },
      ],
      example:
        'await api.renameValues({ select: { kind: "all" }, property: "type", mappings: [{ from: "Interview", to: "interview" }] })',
      destructive: true,
      snapshotted: true,
    },
    {
      id: "copy-property",
      name: "Copy frontmatter property",
      commandId: "frontmatter-operator:copy-property",
      apiMethod: "copyProperty",
      description:
        "Copy values from one or more source properties into a target property. Sources are kept; the target is populated.",
      parameters: [
        SELECT_PARAMETER,
        {
          name: "fromProperties",
          type: "string[]",
          required: true,
          description: "One or more source property names. Multiple sources are merged into the target.",
        },
        {
          name: "toProperty",
          type: "string",
          required: true,
          description: "Target property name.",
        },
        {
          name: "onConflict",
          type: '"skip" | "overwrite" | "merge_list"',
          required: false,
          description: "Behavior when the target already has a value. Defaults to `skip`.",
        },
        {
          name: "wrapWikilink",
          type: "boolean",
          required: false,
          description: "Wrap copied values as [[wikilink]].",
        },
      ],
      example:
        'await api.copyProperty({ select: { kind: "filter", conditions: [{ property: "Thema", operator: "is_not_empty" }] }, fromProperties: ["Thema"], toProperty: "moc" })',
      destructive: false,
      snapshotted: true,
    },
    {
      id: "merge-properties",
      name: "Merge frontmatter properties",
      commandId: "frontmatter-operator:merge-properties",
      apiMethod: "mergeProperties",
      description:
        "Combine values from several source properties into one target and DELETE the sources afterwards. Used for consolidating legacy keys.",
      parameters: [
        SELECT_PARAMETER,
        {
          name: "fromProperties",
          type: "string[]",
          required: true,
          description: "Two or more source property names. All sources are deleted after merging.",
        },
        {
          name: "toProperty",
          type: "string",
          required: true,
          description: "Target property name.",
        },
        {
          name: "onConflict",
          type: '"skip" | "overwrite" | "merge_list"',
          required: false,
          description: "Behavior when the target already has a value. Defaults to `merge_list`.",
        },
        {
          name: "wrapWikilink",
          type: "boolean",
          required: false,
          description: "Wrap merged values as [[wikilink]].",
        },
      ],
      example:
        'await api.mergeProperties({ select: { kind: "all" }, fromProperties: ["Beschreibung", "Description", "descr"], toProperty: "description" })',
      destructive: true,
      snapshotted: true,
    },
    {
      id: "undo-last",
      name: "Undo last frontmatter action",
      commandId: "frontmatter-operator:undo-last",
      apiMethod: "undoLast",
      description:
        "Restore the most recent snapshot, reverting the last action. Returns null when no snapshots exist.",
      parameters: [],
      example: "await api.undoLast()",
      destructive: false,
      snapshotted: false,
    },
    {
      id: "list-properties",
      name: "List frontmatter properties",
      commandId: "frontmatter-operator:list-properties",
      apiMethod: "listProperties",
      description:
        "Return every frontmatter property in the vault with its usage count, observed types, and sample values.",
      parameters: [],
      example: "const props = await api.listProperties()",
      destructive: false,
      snapshotted: false,
    },
    {
      id: "resolve-targets",
      name: "Preview selector (TFile)",
      commandId: "",
      apiMethod: "resolveTargets",
      description:
        "Resolve a NoteSelector into the concrete list of TFile objects it would match. Heavyweight and partly circular -- agents should prefer `getMatchingPaths`, which returns plain paths that serialise cleanly. Useful programmatically for chaining further file operations.",
      parameters: [SELECT_PARAMETER],
      example:
        'const files = await api.resolveTargets({ kind: "filter", conditions: [{ property: "Kategorie", operator: "equals", value: "Person" }] })',
      destructive: false,
      snapshotted: false,
    },
    {
      id: "get-matching-paths",
      name: "Preview selector (paths)",
      commandId: "",
      apiMethod: "getMatchingPaths",
      description:
        "Resolve a NoteSelector into the matching note paths plus a count. Agent-preferred preview: returns plain strings, not TFile objects, so the result survives the call_plugin_api bridge intact.",
      parameters: [SELECT_PARAMETER],
      example:
        'const { count, paths } = await api.getMatchingPaths({ kind: "filter", conditions: [{ property: "Kategorie", operator: "equals", value: "Person" }] })',
      destructive: false,
      snapshotted: false,
    },
    {
      id: "scan",
      name: "Scan vault frontmatter",
      commandId: "",
      apiMethod: "scan",
      description:
        "Scan every markdown note and return the full property inventory: total notes, notes with frontmatter, and per-property stats (usage count, observed types, sample values).",
      parameters: [],
      example: "const inventory = await api.scan()",
      destructive: false,
      snapshotted: false,
    },
    {
      id: "list-snapshots",
      name: "List snapshots",
      commandId: "",
      apiMethod: "listSnapshots",
      description:
        "List the saved undo snapshots, newest first, each with its id, creation timestamp, and number of affected notes. Pass an id to `restoreSnapshot` to revert to that point.",
      parameters: [],
      example: "const snaps = await api.listSnapshots()",
      destructive: false,
      snapshotted: false,
    },
    {
      id: "restore-snapshot",
      name: "Restore snapshot",
      commandId: "",
      apiMethod: "restoreSnapshot",
      description:
        "Restore a specific snapshot by id, reverting the notes it covers to their pre-action state. Returns null when the id is unknown.",
      parameters: [
        {
          name: "id",
          type: "string",
          required: true,
          description: "Snapshot id, as returned by `listSnapshots`.",
        },
      ],
      example: 'await api.restoreSnapshot("20260629-180000-ab12")',
      destructive: true,
      snapshotted: false,
    },
    {
      id: "describe-actions",
      name: "Describe actions",
      commandId: "",
      apiMethod: "describeActions",
      description:
        "Return this catalog: every action with its API method, parameters, an example, and whether it is destructive or snapshotted. The canonical self-description for agents -- call it first to learn the surface.",
      parameters: [],
      example: "const catalog = api.describeActions()",
      destructive: false,
      snapshotted: false,
    },
    {
      id: "cleanup-refusal-tags",
      name: "Clean refusal text from frontmatter",
      commandId: "frontmatter-operator:cleanup-refusal-tags",
      apiMethod: "cleanupRefusalTags",
      description:
        "Remove LLM refusal boilerplate (\"I cannot...\" and similar) from frontmatter values across the vault and return a structured report. Unlike the command, the API call never opens a confirmation dialog. Snapshotted, so reversible via `undoLast`.",
      parameters: [
        {
          name: "dryRun",
          type: "boolean",
          required: false,
          description: "Preview only -- report what would change without writing. Defaults to false.",
        },
        {
          name: "scope",
          type: '"targeted" | "all"',
          required: false,
          description:
            "`targeted` (default) scans the curated generator-target keys (tags, keywords, aliases, topics, concepts, moc, description, summary); `all` scans every non-reserved key.",
        },
        {
          name: "property",
          type: "string",
          required: false,
          description: "Restrict the scan to a single property. Overrides scope.",
        },
      ],
      example: "const report = await api.cleanupRefusalTags({ dryRun: true })",
      destructive: true,
      snapshotted: true,
    },
    {
      id: "dedupe-wikilinks",
      name: "Deduplicate wikilinks",
      commandId: "frontmatter-operator:dedupe-wikilinks",
      apiMethod: "dedupeWikilinks",
      description:
        "Collapse frontmatter wikilinks that resolve to the same note and shorten lone path-form links to Obsidian's canonical form. Returns a structured report. Skips the command's confirmation dialog; snapshotted, so reversible via `undoLast`.",
      parameters: [
        {
          name: "dryRun",
          type: "boolean",
          required: false,
          description: "Preview only -- report what would change without writing. Defaults to false.",
        },
        {
          name: "paths",
          type: "string[]",
          required: false,
          description: "Restrict the scan to these note paths. Omit to scan the whole vault.",
        },
        {
          name: "property",
          type: "string",
          required: false,
          description: "Restrict the scan to a single frontmatter property.",
        },
      ],
      example: 'const report = await api.dedupeWikilinks({ dryRun: true })',
      destructive: true,
      snapshotted: true,
    },
  ],
};

export { ACTION_CATALOG };
