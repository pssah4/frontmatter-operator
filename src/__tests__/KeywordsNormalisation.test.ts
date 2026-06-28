/**
 * Keywords post-parse normalisation -- replicates the inline guard in
 * GeneratorService.run that forces lowercase + cap-5 on the keywords
 * preset output. Pure helper test so we don't have to spin up the
 * full run() pipeline.
 */

import { describe, it, expect } from "vitest";

function normaliseKeywords(items: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const s = String(item).toLowerCase().trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 5) break;
  }
  return out;
}

describe("keywords normalisation", () => {
  it("lowercases every item", () => {
    expect(
      normaliseKeywords(["AI-Agent", "Non-Linear-Writing", "RAG"]),
    ).toEqual(["ai-agent", "non-linear-writing", "rag"]);
  });

  it("caps at 5 entries", () => {
    expect(
      normaliseKeywords([
        "kw1",
        "kw2",
        "kw3",
        "kw4",
        "kw5",
        "kw6",
        "kw7",
        "kw8",
      ]),
    ).toHaveLength(5);
  });

  it("dedups case-insensitively", () => {
    expect(
      normaliseKeywords(["AI-Agent", "ai-agent", "AI-AGENT", "rag"]),
    ).toEqual(["ai-agent", "rag"]);
  });

  it("drops empty and whitespace-only items", () => {
    expect(normaliseKeywords(["", "   ", "real-keyword"])).toEqual([
      "real-keyword",
    ]);
  });

  it("stringifies non-string items defensively", () => {
    expect(
      normaliseKeywords([42, true, "Real-Word"]),
    ).toEqual(["42", "true", "real-word"]);
  });

  it("returns empty for empty input", () => {
    expect(normaliseKeywords([])).toEqual([]);
  });

  it("preserves order of first occurrence on dedup", () => {
    expect(
      normaliseKeywords(["beta", "alpha", "Beta", "gamma"]),
    ).toEqual(["beta", "alpha", "gamma"]);
  });

  it("trims surrounding whitespace from each item", () => {
    expect(
      normaliseKeywords(["  spaced  ", "trimmed"]),
    ).toEqual(["spaced", "trimmed"]);
  });
});
