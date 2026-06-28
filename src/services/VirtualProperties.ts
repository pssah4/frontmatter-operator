/**
 * Virtual properties -- name-only "columns" that aren't in the
 * frontmatter but resolve to a value via a pure function over the
 * NoteRow (path, basename, file metadata). Designed to plug into the
 * existing column / filter / sort / picker plumbing with a single
 * convention: ids start with "__" so isVirtual() is a cheap prefix
 * check. Real frontmatter keys by convention don't lead with
 * underscores, so the collision risk is zero.
 *
 * v1 ships three:
 *   __folder    -- the parent folder path ("notes/area/topic")
 *   __filename  -- the basename (no extension)
 *   __extension -- the file extension ("md" today, "canvas" later)
 *
 * All read-only in v1. Editable virtuals (folder = move-note,
 * filename = rename-file) require confirm + conflict handling and
 * land in v2 when a user asks.
 */

import type { FmValue, NoteRow, PropertyStat } from "../types";

export type VirtualPropertyType = "string" | "number" | "boolean";

export interface VirtualProperty {
  /** Reserved-prefix id ("__folder", etc.). isVirtual() checks the
   *  registry, not the prefix, so future virtuals could break the
   *  convention if needed. */
  id: string;
  /** Human-readable label shown in column headers + pickers. */
  label: string;
  /** Single grouping bucket for v1; pickers show this as a group
   *  separator. */
  group: "Note metadata";
  type: VirtualPropertyType;
  /** Lucide icon id shown in column headers + picker entries. */
  icon: string;
  /** v1 always false. */
  editable: false;
  /** Pure resolver. Must handle root-level notes (no parent). */
  resolve(row: NoteRow): FmValue;
}

const FOLDER: VirtualProperty = {
  id: "__folder",
  label: "Folder",
  group: "Note metadata",
  type: "string",
  icon: "folder",
  editable: false,
  // Vault root parent has path "" -- we return "" so sorting groups
  // root notes at the top alphabetically.
  resolve: (row) => row.file.parent?.path ?? "",
};

const FILENAME: VirtualProperty = {
  id: "__filename",
  label: "Filename",
  group: "Note metadata",
  type: "string",
  icon: "file",
  editable: false,
  resolve: (row) => row.basename,
};

const EXTENSION: VirtualProperty = {
  id: "__extension",
  label: "Extension",
  group: "Note metadata",
  type: "string",
  icon: "file-type",
  editable: false,
  resolve: (row) => row.file.extension,
};

const REGISTRY: ReadonlyMap<string, VirtualProperty> = new Map([
  [FOLDER.id, FOLDER],
  [FILENAME.id, FILENAME],
  [EXTENSION.id, EXTENSION],
]);

export const VirtualProperties = {
  isVirtual(name: string): boolean {
    return REGISTRY.has(name);
  },
  get(name: string): VirtualProperty | undefined {
    return REGISTRY.get(name);
  },
  resolve(name: string, row: NoteRow): FmValue | undefined {
    return REGISTRY.get(name)?.resolve(row);
  },
  all(): VirtualProperty[] {
    return Array.from(REGISTRY.values());
  },
  /**
   * PropertyStat entries for the inventory + picker UI. count is set
   * to the current row count so the meta column shows a sensible
   * "this applies to every note". Sample list stays empty -- the
   * resolver is per-row, listing samples would mean iterating every
   * note for every virtual on every scan.
   */
  asInventoryEntries(rowCount: number): PropertyStat[] {
    return this.all().map((vp) => {
      const types = new Set<PropertyStat["types"] extends Set<infer T> ? T : never>();
      if (vp.type === "string") types.add("string");
      else if (vp.type === "number") types.add("number");
      else if (vp.type === "boolean") types.add("boolean");
      return {
        name: vp.id,
        count: rowCount,
        sampleValues: [],
        types,
      } as PropertyStat;
    });
  },
};
