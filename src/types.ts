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
  "copy",
  "move",
] as const;

export type BulkActionType = (typeof BULK_ACTION_TYPES)[number];

export interface SetAction {
  type: "set";
  property: string;
  value: FmValue;
  mode: "overwrite" | "skip_if_exists" | "merge_list";
}

export interface DeleteAction {
  type: "delete";
  property: string;
}

export interface RenameAction {
  type: "rename";
  fromProperty: string;
  toProperty: string;
  onConflict: "skip" | "overwrite" | "merge_list";
}

export interface CopyAction {
  type: "copy";
  fromProperty: string;
  toProperty: string;
  onConflict: "skip" | "overwrite" | "merge_list";
}

export interface MoveAction {
  type: "move";
  fromProperty: string;
  toProperty: string;
  onConflict: "skip" | "overwrite" | "merge_list";
}

export type BulkAction =
  | SetAction
  | DeleteAction
  | RenameAction
  | CopyAction
  | MoveAction;

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
