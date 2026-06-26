import { describe, it, expect } from "vitest";
import {
  parseSingleLineText,
  parseStringList,
  parseMocPayload,
} from "../services/generator/parsers";

describe("parseSingleLineText", () => {
  it("returns the trimmed first line", () => {
    const r = parseSingleLineText("  A concise sentence.  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("A concise sentence.");
  });

  it("strips fences and quotes", () => {
    const r = parseSingleLineText(
      '```\n"This is a quoted line."\n```\n',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("This is a quoted line.");
  });

  it("rejects empty", () => {
    const r = parseSingleLineText("  \n  ");
    expect(r.ok).toBe(false);
  });
});

describe("parseStringList", () => {
  it("parses a dashed list", () => {
    const r = parseStringList("- ai-agent\n- non-linear-writing\n- creative-process");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["ai-agent", "non-linear-writing", "creative-process"]);
  });

  it("parses a numbered list", () => {
    const r = parseStringList("1. one\n2. two\n3. three");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["one", "two", "three"]);
  });

  it("falls back to comma-split when no dashes", () => {
    const r = parseStringList("alpha, beta, gamma");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["alpha", "beta", "gamma"]);
  });

  it("strips fences", () => {
    const r = parseStringList("```yaml\n- a\n- b\n```");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["a", "b"]);
  });

  it("deduplicates case-insensitively", () => {
    const r = parseStringList("- AI\n- ai\n- Ai\n- ml");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["AI", "ml"]);
  });
});

describe("parseMocPayload", () => {
  it("extracts topics and concepts", () => {
    const raw = `topics:\n  - Travel\n  - Photography\nconcepts:\n  - Place\n  - Memory\n`;
    const r = parseMocPayload(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.topics).toEqual(["Travel", "Photography"]);
      expect(r.value.concepts).toEqual(["Place", "Memory"]);
    }
  });

  it("accepts german keys (Themen / Konzepte)", () => {
    const raw = `Themen:\n  - Reise\nKonzepte:\n  - Ort\n  - Erinnerung\n`;
    const r = parseMocPayload(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.topics).toEqual(["Reise"]);
      expect(r.value.concepts).toEqual(["Ort", "Erinnerung"]);
    }
  });

  it("rejects empty payload", () => {
    expect(parseMocPayload("").ok).toBe(false);
    expect(parseMocPayload("nothing here").ok).toBe(false);
  });
});
