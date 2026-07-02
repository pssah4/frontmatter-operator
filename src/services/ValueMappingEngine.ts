/**
 * Pure value-mapping engine for the Transfer action.
 *
 * Pipeline: source value -> applyTransforms -> lookupMapping ->
 * pass-through-or-rewrite -> wikilink-re-wrap.
 *
 * Scalar and list values both routed through mapFmValue. List values
 * are mapped element-wise (Power-Query "Replace Values" semantics on a
 * multi-valued column).
 */

import type { FmValue, ValueMapping, ValueTransform } from "../types";

/**
 * Run the transform list left-to-right on a string. Pure.
 */
export function applyTransforms(
  raw: string,
  transforms: ValueTransform[],
): string {
  let v = raw;
  for (const t of transforms) {
    if (t === "trim") v = v.trim();
    else if (t === "lowercase") v = v.toLowerCase();
    else if (t === "titlecase") v = toTitleCase(v);
    else if (t === "strip_diacritics") v = stripDiacritics(v);
  }
  return v;
}

function toTitleCase(s: string): string {
  // Word-initial caps + lower rest (Latin only, "ich BIN" -> "Ich Bin").
  return s.replace(/[A-Za-zÀ-ɏ]+/g, (word) =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
  );
}

function stripDiacritics(s: string): string {
  // NFD splits "ö" into "o" + combining diaeresis, then we drop combining marks.
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Look up the mapped target for a (post-transform) source value.
 * Returns undefined when no mapping is registered -- caller treats
 * that as pass-through.
 */
export function lookupMapping(
  transformed: string,
  mappings: ValueMapping[],
): string | undefined {
  for (const m of mappings) {
    if (m.source === transformed) return m.target;
  }
  return undefined;
}

/**
 * Unwrap "[[Foo]]" -> "Foo"; "[[Foo|Bar]]" -> "Foo" (we map the link
 * target, not the alias, so the eventual re-wrap stays consistent).
 * Inputs that don't look like a wikilink are returned unchanged.
 */
export function unwrapWikilink(s: string): string {
  const match = s.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
  return match ? match[1] : s;
}

/**
 * True if the input matches a "[[...]]" wikilink (with optional alias).
 */
export function isWikilink(s: string): boolean {
  return /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.test(s);
}

/**
 * Apply transforms + per-value map element-wise across scalar or list
 * frontmatter values. Returns the rewritten value (same shape as the
 * input). Wikilink wrapping is preserved on rewrite.
 *
 * Non-string scalars (numbers, booleans) are stringified for the
 * mapping table; if the mapping returns a target, the target is kept
 * as a STRING (callers can coerce back via ValueCoercion if needed).
 */
export function mapFmValue(
  v: FmValue,
  transforms: ValueTransform[],
  mappings: ValueMapping[],
): FmValue {
  if (Array.isArray(v)) {
    const out: FmValue[] = [];
    for (const el of v) {
      const mapped = mapScalar(el, transforms, mappings);
      // Drop empty-string mappings (user explicitly deleted that value).
      if (typeof mapped === "string" && mapped === "") continue;
      out.push(mapped);
    }
    // After mapping, dedup so many-to-one (e.g. ["Person","Teilnehmer"]
    // -> "person","person") collapses to a single "person".
    return dedupePreserveOrder(out) as FmValue;
  }
  return mapScalar(v, transforms, mappings);
}

function mapScalar(
  v: FmValue,
  transforms: ValueTransform[],
  mappings: ValueMapping[],
): FmValue {
  // Plain objects (e.g. moc topics+concepts) are not value-mappable
  // in v1; pass through untouched.
  if (v && typeof v === "object" && !Array.isArray(v)) return v;

  if (typeof v !== "string") {
    if (v === null || v === undefined) return v;
    const s = String(v);
    const t = applyTransforms(s, transforms);
    const mapped = lookupMapping(t, mappings);
    if (mapped === undefined) {
      // Apply transforms even when no mapping is registered, so e.g.
      // a "lowercase" chip with empty mapping table still rewrites
      // every value. The original value passes through only when no
      // transform changed it.
      return t === s ? v : t;
    }
    return mapped;
  }

  // String case. Unwrap wikilink first so the mapping table sees the
  // bare link target, then re-wrap on the way out.
  const wasLink = isWikilink(v);
  const inner = unwrapWikilink(v);
  const t = applyTransforms(inner, transforms);
  const mapped = lookupMapping(t, mappings);
  const newInner = mapped !== undefined ? mapped : t;
  if (newInner === inner && t === inner) return v; // total pass-through preserves original spelling
  if (newInner === "") return ""; // deletion marker; list path filters these out
  return wasLink ? `[[${newInner}]]` : newInner;
}

function dedupePreserveOrder(arr: FmValue[]): FmValue[] {
  const seen = new Set<string>();
  const out: FmValue[] = [];
  for (const v of arr) {
    const key = typeof v === "string" ? v : JSON.stringify(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
