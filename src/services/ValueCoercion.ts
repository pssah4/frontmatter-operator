import type { FmValue } from "../types";

const BOOL_TRUE = new Set(["true", "yes", "on", "1"]);
const BOOL_FALSE = new Set(["false", "no", "off", "0"]);

export type ValueKind =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "list"
  | "wikilink"
  | "auto";

export function parseValue(raw: string, kind: ValueKind = "auto"): FmValue {
  const trimmed = raw.trim();
  if (kind === "string") return raw;
  if (kind === "null") return null;
  if (kind === "boolean") {
    const low = trimmed.toLowerCase();
    if (BOOL_TRUE.has(low)) return true;
    if (BOOL_FALSE.has(low)) return false;
    return Boolean(trimmed);
  }
  if (kind === "number") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : raw;
  }
  if (kind === "wikilink") {
    return trimmed.startsWith("[[") ? trimmed : `[[${trimmed}]]`;
  }
  if (kind === "list") {
    return splitList(raw);
  }

  if (trimmed === "") return raw;
  if (trimmed === "null") return null;
  if (BOOL_TRUE.has(trimmed.toLowerCase())) return true;
  if (BOOL_FALSE.has(trimmed.toLowerCase())) return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) return trimmed;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through */
    }
    return splitList(trimmed.slice(1, -1));
  }
  return raw;
}

export function splitList(raw: string): string[] {
  const items: string[] = [];
  let buf = "";
  let depth = 0;
  let inQuote: string | null = null;

  const push = () => {
    const v = buf.trim();
    if (v.length > 0) items.push(v);
    buf = "";
  };

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuote) {
      if (c === inQuote) inQuote = null;
      else buf += c;
      continue;
    }
    if (c === '"' || c === "'") {
      inQuote = c;
      continue;
    }
    if (c === "[") {
      depth++;
      buf += c;
      continue;
    }
    if (c === "]") {
      depth = Math.max(0, depth - 1);
      buf += c;
      continue;
    }
    if (c === "," && depth === 0) {
      push();
      continue;
    }
    buf += c;
  }
  push();
  return items;
}

export function mergeListValues(a: FmValue, b: FmValue): FmValue {
  const left = Array.isArray(a) ? a : a === undefined || a === null ? [] : [a];
  const right = Array.isArray(b) ? b : b === undefined || b === null ? [] : [b];
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const v of [...left, ...right]) {
    const key = typeof v === "string" ? v : JSON.stringify(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out as FmValue;
}
