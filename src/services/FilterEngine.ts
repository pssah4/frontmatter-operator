import type {
  Filter,
  FilterCombinator,
  FmValue,
  NoteRow,
} from "../types";
import { VirtualProperties } from "./VirtualProperties";

// HARD-03: cap the source length of a user-supplied regex to bound the worst
// case for catastrophic backtracking. 200 chars is enough for any reasonable
// vault search but rejects the typical (a+)+(b+)+... ReDoS payloads.
const MAX_REGEX_SOURCE_LENGTH = 200;

export function isRegexAllowed(source: string): boolean {
  return source.length > 0 && source.length <= MAX_REGEX_SOURCE_LENGTH;
}

function toComparableString(
  v: FmValue | undefined,
  caseSensitive: boolean,
): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (Array.isArray(v)) s = v.map((x) => String(x)).join(", ");
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  return caseSensitive ? s : s.toLowerCase();
}

function arrayItems(v: FmValue | undefined): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "object") return [JSON.stringify(v)];
  return [String(v)];
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

export function evaluateFilter(filter: Filter, row: NoteRow): boolean {
  const cs = !!filter.caseSensitive;
  // Virtual properties (__folder, __filename, __extension) resolve
  // via the registry instead of row.frontmatter. The synthesized
  // value participates in every operator just like a real frontmatter
  // value would. in_path stays property-agnostic -- it always reads
  // row.path regardless of filter.property.
  const isVirtual = VirtualProperties.isVirtual(filter.property);
  const fm = row.frontmatter;
  const has = isVirtual
    ? VirtualProperties.resolve(filter.property, row) !== undefined
    : Object.prototype.hasOwnProperty.call(fm, filter.property);
  const value = isVirtual
    ? VirtualProperties.resolve(filter.property, row)
    : has
      ? fm[filter.property]
      : undefined;
  const rawNeedle = filter.value ?? "";
  const needle = cs ? rawNeedle : rawNeedle.toLowerCase();

  switch (filter.operator) {
    case "exists":
      return has;
    case "not_exists":
      return !has;
    case "is_empty":
      return !has || isEmptyValue(value);
    case "is_not_empty":
      return has && !isEmptyValue(value);
    case "is_list":
      return has && Array.isArray(value);
    case "is_string":
      return has && typeof value === "string";
    case "in_path":
      return (
        (cs ? row.path : row.path.toLowerCase()).indexOf(needle) !== -1
      );
    case "equals": {
      if (!has) return false;
      if (Array.isArray(value)) {
        return value.some(
          (v) => toComparableString(v, cs) === needle,
        );
      }
      return toComparableString(value, cs) === needle;
    }
    case "not_equals": {
      if (!has) return true;
      if (Array.isArray(value)) {
        return !value.some(
          (v) => toComparableString(v, cs) === needle,
        );
      }
      return toComparableString(value, cs) !== needle;
    }
    case "contains": {
      if (!has) return false;
      if (Array.isArray(value)) {
        return value.some(
          (v) => toComparableString(v, cs).indexOf(needle) !== -1,
        );
      }
      return toComparableString(value, cs).indexOf(needle) !== -1;
    }
    case "not_contains": {
      if (!has) return true;
      if (Array.isArray(value)) {
        return !value.some(
          (v) => toComparableString(v, cs).indexOf(needle) !== -1,
        );
      }
      return toComparableString(value, cs).indexOf(needle) === -1;
    }
    case "starts_with":
      return has && toComparableString(value, cs).startsWith(needle);
    case "ends_with":
      return has && toComparableString(value, cs).endsWith(needle);
    case "matches_regex": {
      if (!has) return false;
      if (!isRegexAllowed(rawNeedle)) return false;
      let re: RegExp;
      try {
        re = new RegExp(rawNeedle, cs ? "" : "i");
      } catch {
        return false;
      }
      if (Array.isArray(value)) {
        return value.some((v) => re.test(String(v)));
      }
      return re.test(toComparableString(value, true));
    }
    default:
      return false;
  }
}

export function applyFilters(
  rows: NoteRow[],
  filters: Filter[],
  combinator: FilterCombinator = "AND",
): NoteRow[] {
  if (filters.length === 0) return rows.slice();
  return rows.filter((row) => {
    if (combinator === "AND") {
      return filters.every((f) => evaluateFilter(f, row));
    }
    return filters.some((f) => evaluateFilter(f, row));
  });
}

export { arrayItems };
