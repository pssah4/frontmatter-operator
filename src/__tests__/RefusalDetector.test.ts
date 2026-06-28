/**
 * RefusalDetector -- looksLikeRefusal + listLooksLikeRefusal + the
 * UNABLE_TO_GENERATE sentinel. The user reported tag entries like
 * "Based on the note content provide" / "I need to see the active
 * note" / "since no note content was shared" / "I'll wait for the
 * note content" landing in frontmatter; these tests pin every one
 * of those phrasings as refusal and every realistic keyword as a
 * pass.
 */

import { describe, it, expect } from "vitest";
import {
  REFUSAL_SENTINEL,
  listLooksLikeRefusal,
  looksLikeRefusal,
  textLooksLikeMetaCommentary,
} from "../services/generator/GeneratorService";

describe("looksLikeRefusal -- sentinel", () => {
  it("matches the bare sentinel", () => {
    expect(looksLikeRefusal(REFUSAL_SENTINEL)).toBe(true);
  });

  it("matches the sentinel with surrounding whitespace", () => {
    expect(looksLikeRefusal(`  ${REFUSAL_SENTINEL}  `)).toBe(true);
  });

  it("matches the sentinel embedded in a longer message", () => {
    expect(
      looksLikeRefusal(`Sorry, ${REFUSAL_SENTINEL} -- the note is empty`),
    ).toBe(true);
  });
});

describe("looksLikeRefusal -- the user's exact reproductions", () => {
  it("'Based on the note content provide...' (with refusal continuation)", () => {
    expect(
      looksLikeRefusal(
        "Based on the note content provided, I cannot generate keywords.",
      ),
    ).toBe(true);
  });

  it("'I need to see the active note to generate keywords'", () => {
    expect(
      looksLikeRefusal("I need to see the active note to generate keywords."),
    ).toBe(true);
  });

  it("'since no note content was shared'", () => {
    expect(
      looksLikeRefusal("since no note content was shared, I cannot help."),
    ).toBe(true);
  });

  it("'I'll wait for the note content.'", () => {
    expect(looksLikeRefusal("I'll wait for the note content.")).toBe(true);
  });

  it("'Please share the note content first'", () => {
    expect(
      looksLikeRefusal("Please share the note content first."),
    ).toBe(true);
  });

  it("'Without the actual note, I cannot generate'", () => {
    expect(
      looksLikeRefusal("Without the actual note, I cannot generate tags."),
    ).toBe(true);
  });
});

describe("looksLikeRefusal -- legacy patterns still pass", () => {
  it("'I cannot generate keywords'", () => {
    expect(looksLikeRefusal("I cannot generate keywords")).toBe(true);
  });

  it("'Sorry, I am unable to help'", () => {
    expect(looksLikeRefusal("Sorry, I am unable to help")).toBe(true);
  });

  it("German: 'Ich kann das nicht'", () => {
    expect(looksLikeRefusal("Ich kann das nicht erstellen")).toBe(true);
  });

  it("German: 'Die Notiz ist leer'", () => {
    expect(looksLikeRefusal("Die Notiz ist leer")).toBe(true);
  });

  it("German: 'Ich brauche den Inhalt'", () => {
    expect(looksLikeRefusal("Ich brauche den Inhalt der Notiz")).toBe(true);
  });
});

describe("looksLikeRefusal -- real answers pass through", () => {
  it("a one-line description is NOT refusal", () => {
    expect(
      looksLikeRefusal(
        "Discusses non-linear writing practices and how to integrate them into a daily Obsidian workflow.",
      ),
    ).toBe(false);
  });

  it("a paragraph-long description is NOT refusal", () => {
    const long = "This note explores ".repeat(40);
    expect(looksLikeRefusal(long)).toBe(false);
  });

  it("an answer containing the substring 'i need' in the middle is NOT a refusal", () => {
    expect(
      looksLikeRefusal(
        "The author explores why I need short feedback loops in writing.",
      ),
    ).toBe(false);
  });

  it("an empty string is NOT a refusal (caller handles emptiness separately)", () => {
    expect(looksLikeRefusal("")).toBe(false);
  });
});

describe("listLooksLikeRefusal", () => {
  it("the user's exact tag list is detected as refusal", () => {
    expect(
      listLooksLikeRefusal([
        "Based on the note content provide",
        "I need to see the active note to ge",
        "since no note content was shared",
        "I'll wait for the note content.",
      ]),
    ).toBe(true);
  });

  it("a real keyword list passes through", () => {
    expect(
      listLooksLikeRefusal([
        "non-linear-writing",
        "obsidian-workflow",
        "AI-agent",
        "knowledge-management",
        "daily-notes",
      ]),
    ).toBe(false);
  });

  it("mixed list with majority keywords still passes", () => {
    expect(
      listLooksLikeRefusal([
        "non-linear-writing",
        "obsidian-workflow",
        "AI-agent",
        "I cannot help",
      ]),
    ).toBe(false);
  });

  it("majority sentence-like = refusal", () => {
    expect(
      listLooksLikeRefusal([
        "non-linear-writing",
        "I need to see",
        "I'll wait for content",
        "since no note was provided",
      ]),
    ).toBe(true);
  });

  it("single sentence-like item = refusal", () => {
    expect(
      listLooksLikeRefusal(["I cannot help."]),
    ).toBe(true);
  });

  it("single keyword item = pass", () => {
    expect(listLooksLikeRefusal(["non-linear-writing"])).toBe(false);
  });

  it("empty list = pass (not detected as refusal; caller treats as parse error)", () => {
    expect(listLooksLikeRefusal([])).toBe(false);
  });

  it("question-marked items are sentence-like", () => {
    expect(
      listLooksLikeRefusal([
        "what is this note about?",
        "could you share more?",
      ]),
    ).toBe(true);
  });

  it("real keywords with hyphens, capitalisation, parens all pass", () => {
    expect(
      listLooksLikeRefusal([
        "Generative-AI",
        "RAG",
        "vector-store",
        "embedding-model",
        "semantic-search",
      ]),
    ).toBe(false);
  });
});

describe("textLooksLikeMetaCommentary -- catches paraphrased refusals on non-empty notes", () => {
  it("'The note content provided is insufficient...'", () => {
    expect(
      textLooksLikeMetaCommentary(
        "The note content provided is insufficient to generate a summary.",
      ),
    ).toBe(true);
  });

  it("'The note appears to be too short...'", () => {
    expect(
      textLooksLikeMetaCommentary(
        "The note appears to be too short for a meaningful description.",
      ),
    ).toBe(true);
  });

  it("'I cannot derive keywords from this content'", () => {
    expect(
      textLooksLikeMetaCommentary(
        "I cannot derive keywords from this content alone.",
      ),
    ).toBe(true);
  });

  it("'The content does not contain enough information'", () => {
    expect(
      textLooksLikeMetaCommentary(
        "The content does not contain enough information to summarise.",
      ),
    ).toBe(true);
  });

  it("'Please provide more context for this note'", () => {
    expect(
      textLooksLikeMetaCommentary(
        "Please provide more context for this note before I can answer.",
      ),
    ).toBe(true);
  });

  it("German: 'Diese Notiz enthaelt zu wenig Informationen'", () => {
    expect(
      textLooksLikeMetaCommentary(
        "Diese Notiz enthält zu wenig Informationen für eine Zusammenfassung.",
      ),
    ).toBe(true);
  });

  it("German: 'Der Inhalt reicht nicht aus'", () => {
    expect(
      textLooksLikeMetaCommentary(
        "Der Inhalt reicht nicht aus, um sinnvolle Keywords zu erzeugen.",
      ),
    ).toBe(true);
  });

  it("a real one-line description passes through", () => {
    expect(
      textLooksLikeMetaCommentary(
        "Explores how to integrate non-linear writing into a daily Obsidian workflow.",
      ),
    ).toBe(false);
  });

  it("a real description that mentions 'the note' in passing passes", () => {
    expect(
      textLooksLikeMetaCommentary(
        "Maps the historical use of non-linear writing tools.",
      ),
    ).toBe(false);
  });

  it("a description starting with 'I' as a personal pronoun but no meta-verb passes", () => {
    // Real summary that happens to start with "I" -- no meta verb,
    // so not a refusal.
    expect(
      textLooksLikeMetaCommentary("I outline three principles for daily review."),
    ).toBe(false);
  });

  it("a long real description with > 400 chars is never a refusal", () => {
    const long = "The note describes how to build a daily review habit. ".repeat(8);
    expect(textLooksLikeMetaCommentary(long)).toBe(false);
  });

  it("empty string is not a refusal (caller handles emptiness separately)", () => {
    expect(textLooksLikeMetaCommentary("")).toBe(false);
  });
});

describe("looksLikeRefusal integration -- the meta-commentary cases all roll up", () => {
  it("paraphrased refusal also caught by looksLikeRefusal", () => {
    expect(
      looksLikeRefusal(
        "The note content provided is insufficient to generate a summary.",
      ),
    ).toBe(true);
  });

  it("German meta-commentary caught by looksLikeRefusal", () => {
    expect(
      looksLikeRefusal(
        "Der Inhalt reicht nicht aus für eine Zusammenfassung.",
      ),
    ).toBe(true);
  });
});
