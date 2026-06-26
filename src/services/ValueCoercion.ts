import type { FmValue, Frontmatter } from "../types";

const BOOL_TRUE = new Set(["true", "yes", "on", "1"]);
const BOOL_FALSE = new Set(["false", "no", "off", "0"]);

export type ValueKind =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "list"
  | "wikilink"
  | "template"
  | "auto";

const SINGLE_TEMPLATE_RE = /^\{\{\s*([^{}]+?)\s*\}\}$/;
const ANY_TEMPLATE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function isTemplateString(raw: string): boolean {
  return ANY_TEMPLATE_RE.test(raw);
}

export function resolveTemplate(template: string, fm: Frontmatter): FmValue {
  const single = template.match(SINGLE_TEMPLATE_RE);
  if (single) {
    const key = single[1].trim();
    const v = fm[key];
    return v === undefined ? null : v;
  }
  return template.replace(ANY_TEMPLATE_RE, (_match, key) => {
    const v = fm[key.trim()];
    if (v === undefined || v === null) return "";
    if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  });
}

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
  if (kind === "template") {
    return raw;
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

export function wrapAsWikilink(value: FmValue): FmValue {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => wrapAsWikilink(item) as never) as FmValue;
  }
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return value;
  if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) return value;
  return `[[${trimmed}]]`;
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
