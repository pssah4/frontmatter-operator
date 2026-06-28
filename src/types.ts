import type { TFile } from "obsidian";

export type FmPrimitive = string | number | boolean | null;
export type FmValue = FmPrimitive | FmPrimitive[] | Record<string, unknown>;
export type Frontmatter = Record<string, FmValue>;

export const FILTER_OPERATORS = [
  "exists",
  "not_exists",
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "matches_regex",
  "is_empty",
  "is_not_empty",
  "is_list",
  "is_string",
  "in_path",
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export interface Filter {
  id: string;
  property: string;
  operator: FilterOperator;
  value?: string;
  caseSensitive?: boolean;
}

export type FilterCombinator = "AND" | "OR";

export interface PropertyStat {
  name: string;
  count: number;
  sampleValues: string[];
  types: Set<"string" | "number" | "boolean" | "list" | "object" | "null">;
}

export interface ScanResult {
  totalNotes: number;
  notesWithFrontmatter: number;
  properties: PropertyStat[];
}

export interface NoteRow {
  file: TFile;
  path: string;
  basename: string;
  frontmatter: Frontmatter;
}

export const BULK_ACTION_TYPES = [
  "set",
  "delete",
  "rename",
  "copy", // legacy -- kept so old snapshots replay; new writes emit 'transfer'
  "move", // legacy -- ditto
  "transfer",
] as const;

/**
 * Pre-baked bulk transforms that run on every source value BEFORE the
 * per-value mapping table is consulted. Order matters: applied
 * left-to-right.
 */
export const VALUE_TRANSFORMS = [
  "trim",
  "lowercase",
  "titlecase",
  "strip_diacritics",
] as const;
export type ValueTransform = (typeof VALUE_TRANSFORMS)[number];

export const VALUE_TRANSFORM_LABELS: Record<ValueTransform, string> = {
  trim: "Trim",
  lowercase: "lowercase",
  titlecase: "Titlecase",
  strip_diacritics: "Strip accents",
};

/**
 * One source-value -> target-value rewrite. The engine treats a value
 * as pass-through when it has no entry in the mapping table.
 * Many-to-one is expressed as multiple ValueMapping rows pointing at
 * the same target. List-valued frontmatter (e.g. tags: [Person,Speaker])
 * is mapped element-wise; wikilinks ([[Foo]]) are unwrapped, mapped,
 * then re-wrapped.
 */
export interface ValueMapping {
  /** Raw source value as it appears in frontmatter, AFTER list-flatten
   *  and wikilink-unwrap. Non-strings are stringified for the mapping
   *  table and coerced back via ValueCoercion.parseValue('auto'). */
  source: string;
  /** Free-text target the user typed. Empty string drops the value. */
  target: string;
  /** True if the user hand-edited this row. Used by quick-transform
   *  chips so they don't overwrite manual fixes. */
  userEdited: boolean;
}

export interface TransferAction {
  type: "transfer";
  /** Source frontmatter keys. >= 1, no upper limit. */
  fromProperties: string[];
  /** Target frontmatter key. */
  toProperty: string;
  /** false = Copy (sources preserved), true = Move (sources deleted). */
  deleteSource: boolean;
  /** Behavior when toProperty already has a value on a note. */
  onConflict: "skip" | "overwrite" | "merge_list";
  wrapWikilink?: boolean;
  /** Bulk transforms applied to every source value before the
   *  per-value mapping table is consulted. Empty list = no transform. */
  transforms: ValueTransform[];
  /** Per-distinct-source-value rewrite table. Sparse: missing entries
   *  pass through unchanged (after transforms). */
  valueMappings: ValueMapping[];
}

export type BulkActionType = (typeof BULK_ACTION_TYPES)[number];

export interface SetAction {
  type: "set";
  property: string;
  value: FmValue;
  mode: "overwrite" | "skip_if_exists" | "merge_list";
  template?: boolean;
  wrapWikilink?: boolean;
}

export interface DeleteAction {
  type: "delete";
  properties: string[];
}

export interface RenameAction {
  type: "rename";
  fromProperties: string[];
  toProperty: string;
  onConflict: "skip" | "overwrite" | "merge_list";
  wrapWikilink?: boolean;
}

export interface CopyAction {
  type: "copy";
  fromProperties: string[];
  toProperty: string;
  onConflict: "skip" | "overwrite" | "merge_list";
  wrapWikilink?: boolean;
}

export interface MoveAction {
  type: "move";
  fromProperties: string[];
  toProperty: string;
  onConflict: "skip" | "overwrite" | "merge_list";
  wrapWikilink?: boolean;
}

export type BulkAction =
  | SetAction
  | DeleteAction
  | RenameAction
  | CopyAction
  | MoveAction
  | TransferAction;

export interface ActionPreview {
  path: string;
  before: Frontmatter;
  after: Frontmatter;
  changed: boolean;
  skippedReason?: string;
}

export interface ActionResult {
  successCount: number;
  skippedCount: number;
  errorCount: number;
  errors: Array<{ path: string; message: string }>;
  snapshotId?: string;
}

export interface Snapshot {
  id: string;
  createdAt: string;
  action: BulkAction;
  entries: Array<{
    path: string;
    before: Frontmatter | null;
  }>;
}
