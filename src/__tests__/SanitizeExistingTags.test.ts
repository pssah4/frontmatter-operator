/**
 * sanitizeExistingListString + isRefusalItem -- the engine guard that
 * stops the 476-note leak from perpetuating itself on every append
 * run. Pins:
 *   - the user's exact 4 leaked phrasings are all isRefusalItem
 *   - mixed lists keep real keywords, drop refusal items
 *   - fully polluted lists drop everything
 *   - clean lists pass through unchanged
 *   - KNOWN_REFUSAL_SUBSTRINGS contains the user's reported phrases
 */

import { describe, it, expect } from "vitest";
import {
  KNOWN_REFUSAL_SUBSTRINGS,
  isRefusalItem,
  looksLikeKeyword,
  sanitizeExistingListString,
} from "../services/generator/GeneratorService";

const USER_REPORTED_LEAK = [
  "Based on the note content provided",
  "I need to see the active note to generate keywords. However",
  "since no note content was shared in this message",
  "I'll wait for the actual note content.",
];

describe("isRefusalItem -- catches the user's exact 4 leaked phrasings", () => {
  for (const phrase of USER_REPORTED_LEAK) {
    it(`flags "${phrase.slice(0, 40)}..."`, () => {
      expect(isRefusalItem(phrase)).toBe(true);
    });
  }

  it("flags 'UNABLE_TO_GENERATE' as refusal", () => {
    expect(isRefusalItem("UNABLE_TO_GENERATE")).toBe(true);
  });

  it("flags 'unable to generate keywords' (substring match)", () => {
    expect(isRefusalItem("unable to generate keywords")).toBe(true);
  });

  it("does NOT flag real keywords", () => {
    expect(isRefusalItem("ai-agent")).toBe(false);
    expect(isRefusalItem("non-linear-writing")).toBe(false);
    expect(isRefusalItem("knowledge-management")).toBe(false);
    expect(isRefusalItem("rag")).toBe(false);
  });

  it("flags empty / whitespace as non-refusal (caller handles emptiness)", () => {
    expect(isRefusalItem("")).toBe(false);
    expect(isRefusalItem("   ")).toBe(false);
  });
});

describe("sanitizeExistingListString", () => {
  it("drops everything when the whole list is the user-reported leak", () => {
    expect(sanitizeExistingListString(USER_REPORTED_LEAK)).toEqual([]);
  });

  it("keeps real keywords, drops refusal items from a mixed list", () => {
    const input = [
      "ai-agent",
      "Based on the note content provided",
      "non-linear-writing",
      "I'll wait for the actual note content.",
      "rag",
    ];
    expect(sanitizeExistingListString(input)).toEqual([
      "ai-agent",
      "non-linear-writing",
      "rag",
    ]);
  });

  it("passes a clean list through unchanged", () => {
    const input = ["ai-agent", "non-linear-writing", "rag", "obsidian-workflow"];
    expect(sanitizeExistingListString(input)).toEqual(input);
  });

  it("returns empty array for empty input", () => {
    expect(sanitizeExistingListString([])).toEqual([]);
  });

  it("drops a partially-polluted list when refusals dominate", () => {
    const input = [
      "ai-agent",
      "Based on the note content provided",
      "I need to see the note",
      "I'll wait for the actual note content.",
    ];
    // listLooksLikeRefusal: 3 of 4 sentence-shaped -> >=50% -> drop all.
    expect(sanitizeExistingListString(input)).toEqual([]);
  });

  it("does not drop the only one valid keyword when refusals are a minority", () => {
    const input = [
      "ai-agent",
      "non-linear-writing",
      "rag",
      "obsidian-workflow",
      "Based on the note content provided",
    ];
    // 1 of 5 sentence-shaped -> minority -> filter individually.
    expect(sanitizeExistingListString(input)).toEqual([
      "ai-agent",
      "non-linear-writing",
      "rag",
      "obsidian-workflow",
    ]);
  });
});

describe("KNOWN_REFUSAL_SUBSTRINGS", () => {
  it("contains each of the user's exact reported substrings (lowercase)", () => {
    expect(KNOWN_REFUSAL_SUBSTRINGS).toContain(
      "based on the note content provided",
    );
    expect(KNOWN_REFUSAL_SUBSTRINGS).toContain("i need to see the active note");
    expect(KNOWN_REFUSAL_SUBSTRINGS).toContain("no note content was shared");
    expect(KNOWN_REFUSAL_SUBSTRINGS).toContain(
      "i'll wait for the actual note content",
    );
  });

  it("every entry is lowercase", () => {
    for (const s of KNOWN_REFUSAL_SUBSTRINGS) {
      expect(s).toBe(s.toLowerCase());
    }
  });
});

describe("looksLikeKeyword exported", () => {
  it("is callable", () => {
    expect(looksLikeKeyword("ai-agent")).toBe(true);
    expect(looksLikeKeyword("I need to see")).toBe(false);
  });
});
