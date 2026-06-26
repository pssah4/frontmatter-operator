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
} from "../types";
import { applyFilters, evaluateFilter } from "../services/FilterEngine";
import { FILTER_OPERATORS } from "../types";

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
 * Public, stable surface of the Frontmatter Editor plugin.
 *
 * Exposed as `app.plugins.plugins["frontmatter-editor"].api`.
 *
 * Every mutating method writes a JSON snapshot under
 * `<vault>/.frontmatter-editor/snapshots/{id}.json` and returns the
 * snapshot id so the caller can restore via {@link FrontmatterEditorAPI.restoreSnapshot}
 * or {@link FrontmatterEditorAPI.undoLast}.
 */
export class FrontmatterEditorAPI {
  /** Stable API contract version. Bumped on breaking changes. */
  readonly version = "1.0.0";

  constructor(
    private readonly app: App,
    private readonly scanner: FrontmatterScanner,
    private readonly bulk: BulkActionService,
    private readonly snapshots: SnapshotService,
  ) {}

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
    const rows = await this.selectorToRows(select);
    return rows.map((r) => r.file);
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
    const rows = await this.selectorToRows(opts.select);
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
    const rows = await this.selectorToRows(opts.select);
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
    const rows = await this.selectorToRows(opts.select);
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
    const rows = await this.selectorToRows(opts.select);
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
    const rows = await this.selectorToRows(opts.select);
    return this.bulk.executeAction(rows, {
      type: "move",
      fromProperties: opts.fromProperties,
      toProperty: opts.toProperty,
      onConflict: opts.onConflict ?? "merge_list",
      wrapWikilink: opts.wrapWikilink,
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

  private async selectorToRows(select: NoteSelector): Promise<NoteRow[]> {
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
  pluginId: "frontmatter-editor",
  pluginName: "Frontmatter Editor",
  version: "1.0.0",
  description:
    "Bulk-edit YAML frontmatter across the Obsidian vault. Filter notes by any property condition, then set, delete, rename, copy or merge properties. Every action writes a JSON snapshot and is undo-able. Safe for use from a Vault Operator skill.",
  actions: [
    {
      id: "set-property",
      name: "Set frontmatter property",
      commandId: "frontmatter-editor:set-property",
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
      commandId: "frontmatter-editor:delete-properties",
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
      commandId: "frontmatter-editor:rename-property",
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
      id: "copy-property",
      name: "Copy frontmatter property",
      commandId: "frontmatter-editor:copy-property",
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
      commandId: "frontmatter-editor:merge-properties",
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
      commandId: "frontmatter-editor:undo-last",
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
      commandId: "frontmatter-editor:list-properties",
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
      name: "Preview selector",
      commandId: "frontmatter-editor:resolve-targets",
      apiMethod: "resolveTargets",
      description:
        "Resolve a NoteSelector into the concrete list of TFile objects it would match. Useful for previewing a rule before applying it.",
      parameters: [SELECT_PARAMETER],
      example:
        'const files = await api.resolveTargets({ kind: "filter", conditions: [{ property: "Kategorie", operator: "equals", value: "Person" }] })',
      destructive: false,
      snapshotted: false,
    },
  ],
};

export { ACTION_CATALOG };
