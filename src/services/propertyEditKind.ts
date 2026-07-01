/**
 * propertyEditKind -- decide which inline editor a frontmatter PROPERTY
 * should use, independent of the value in any single cell.
 *
 * The inline cell editor used to pick its editor purely from the current
 * cell's value type. That made the SAME property edit inconsistently: a
 * `type` note holding `[source]` got the chip/list editor (new value becomes a
 * list element), but a note where `type` was empty or a bare string got the
 * text editor (new value becomes plain text). This resolver gives the cell a
 * stable per-property preference so a list-typed property always edits as a
 * list.
 *
 * Pure and DOM-free for unit testing.
 */

export type EditKind = "list" | "number" | "boolean" | "text";

/** The value types the FrontmatterScanner records per property. */
export type ObservedValueType =
  | "string"
  | "number"
  | "boolean"
  | "list"
  | "object"
  | "null";

/** Obsidian metadata-type-manager widget types that mean "list of values". */
const OBSIDIAN_LIST_TYPES = new Set(["multitext", "tags", "aliases", "cssclasses"]);

function fromObsidianType(type: string | undefined): EditKind | undefined {
  if (!type) return undefined;
  if (OBSIDIAN_LIST_TYPES.has(type)) return "list";
  if (type === "number") return "number";
  if (type === "checkbox") return "boolean";
  if (type === "text" || type === "date" || type === "datetime") return "text";
  return undefined; // "unknown" / custom -> defer to observed types
}

function fromObservedTypes(
  types: ReadonlySet<ObservedValueType> | undefined,
): EditKind | undefined {
  if (!types || types.size === 0) return undefined;
  // Any list observation means the property carries multiple values -> list.
  if (types.has("list")) return "list";
  // Objects are edited as raw JSON by value; no list/scalar preference.
  if (types.has("object")) return undefined;
  const concrete = [...types].filter((t) => t !== "null");
  if (concrete.length === 0) return undefined; // only nulls -> no preference
  if (concrete.length === 1) {
    if (concrete[0] === "number") return "number";
    if (concrete[0] === "boolean") return "boolean";
    if (concrete[0] === "string") return "text";
  }
  return "text"; // mixed scalar types -> safest is free text
}

/**
 * Obsidian's declared property type wins (it is the user's explicit choice in
 * the Properties UI); otherwise the scanner's observed value types decide.
 * Returns undefined when there is no signal (brand-new property) so the cell
 * can fall back to value-based editor selection.
 */
export function resolvePropertyEditKind(
  obsidianType: string | undefined,
  observedTypes: ReadonlySet<ObservedValueType> | undefined,
): EditKind | undefined {
  return fromObsidianType(obsidianType) ?? fromObservedTypes(observedTypes);
}
