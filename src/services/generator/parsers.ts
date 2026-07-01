import type { FmValue } from "../../types";
import type { GeneratorParserId } from "../../types/generators";

/**
 * Deterministic parsers for LLM output. Each parser takes the raw model
 * response and returns either {ok: true, value} or {ok: false, error}.
 *
 * Parsers are LLM-output-only: they never touch the vault. The result is
 * handed to BulkActionService, which applies it through processFrontMatter
 * with the same merge / wikilink / conflict rules as the manual Set action.
 */

export type ParseResult =
  | { ok: true; value: FmValue }
  | { ok: false; error: string };

export interface ParsedMocPayload {
  topics: string[];
  concepts: string[];
}

export type GeneratorParser = (raw: string) => ParseResult;

const STRIP_CODE_FENCE_RE = /^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/;

function stripCodeFences(input: string): string {
  const m = input.match(STRIP_CODE_FENCE_RE);
  return (m ? m[1] : input).trim();
}

/**
 * I-1 / L-5 (AUDIT 2026-07-02): fail-closed on LLM output. Strip residual
 * control characters (newlines, tabs, NUL, DEL) before any parsed value
 * reaches the frontmatter writer, instead of relying on the YAML layer to
 * escape them. Shared by all three parsers so every generator target gets
 * the same scrub.
 */
function stripControlChars(input: string): string {
  return Array.from(input)
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c >= 32 && c !== 127;
    })
    .join("");
}

/** "Just one sentence" — collapse whitespace, drop quotes, cap at 25 words. */
export const parseSingleLineText: GeneratorParser = (raw) => {
  const trimmed = stripCodeFences(raw).trim();
  if (!trimmed) return { ok: false, error: "empty response" };
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? "";
  if (!firstLine) return { ok: false, error: "empty first line" };
  const unquoted = firstLine.replace(/^["'`](.*)["'`]$/s, "$1").trim();
  const collapsed = stripControlChars(unquoted.replace(/\s+/g, " ")).trim();
  if (!collapsed) return { ok: false, error: "empty after scrub" };
  return { ok: true, value: collapsed };
};

/** Reads a YAML-style list of dashed items into a string[]. Tolerates
 *  numbered lists, comma-separated single lines and stray markdown. */
export const parseStringList: GeneratorParser = (raw) => {
  const cleaned = stripCodeFences(raw);
  const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items: string[] = [];
  for (const line of lines) {
    if (line.startsWith("```") || line.startsWith("---")) continue;
    const dash = line.match(/^[-*]\s+(.+?)\s*$/);
    if (dash) {
      items.push(dash[1].replace(/^["'`](.*)["'`]$/, "$1"));
      continue;
    }
    const numbered = line.match(/^\d+[.)]\s+(.+?)\s*$/);
    if (numbered) {
      items.push(numbered[1].replace(/^["'`](.*)["'`]$/, "$1"));
      continue;
    }
    if (line.includes(",") && items.length === 0) {
      // single-line fallback: split by commas
      for (const part of line.split(",")) {
        const trimmed = part.trim().replace(/^["'`](.*)["'`]$/, "$1");
        if (trimmed) items.push(trimmed);
      }
      break;
    }
  }
  const dedup: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const clean = stripControlChars(item).trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(clean);
  }
  if (dedup.length === 0) return { ok: false, error: "no list items" };
  return { ok: true, value: dedup as FmValue };
};

/** Two-key topics/concepts YAML block. */
export function parseMocPayload(
  raw: string,
): { ok: true; value: ParsedMocPayload } | { ok: false; error: string } {
  const cleaned = stripCodeFences(raw);
  const lines = cleaned.split(/\r?\n/);
  const topics: string[] = [];
  const concepts: string[] = [];
  let mode: "topics" | "concepts" | null = null;
  for (const lineRaw of lines) {
    const line = lineRaw.replace(/^\s+/, "");
    if (!line) continue;
    const head = line.match(/^(topics|themes|themen|concepts|konzepte)\s*:/i);
    if (head) {
      const key = head[1].toLowerCase();
      if (key === "topics" || key === "themes" || key === "themen") {
        mode = "topics";
      } else {
        mode = "concepts";
      }
      continue;
    }
    const item = line.match(/^[-*]\s+(.+?)\s*$/);
    if (item && mode) {
      const value = stripControlChars(
        item[1].replace(/^["'`](.*)["'`]$/, "$1"),
      ).trim();
      if (!value) continue;
      if (mode === "topics") topics.push(value);
      else concepts.push(value);
    }
  }
  if (topics.length === 0 && concepts.length === 0) {
    return { ok: false, error: "no topics or concepts parsed" };
  }
  return { ok: true, value: { topics, concepts } };
}

/** Dispatcher used by the generator runner. */
export function parseResponse(
  parserId: GeneratorParserId,
  raw: string,
): ParseResult {
  switch (parserId) {
    case "single_line_text":
      return parseSingleLineText(raw);
    case "list_string":
      return parseStringList(raw);
    case "moc_topics_concepts": {
      const parsed = parseMocPayload(raw);
      if (!parsed.ok) return parsed;
      // store as { topics: [...], concepts: [...] }
      return { ok: true, value: parsed.value as unknown as FmValue };
    }
  }
}
