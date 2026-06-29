/**
 * WikilinkDedup -- pure core that parses wikilinks alias/subpath-aware
 * and deduplicates/normalises a frontmatter value through an injected
 * link resolver. No Obsidian dependency, so it is exercised here with
 * an inline Map-backed resolver (mirrors the VirtualProperty.resolve
 * injection precedent).
 */

import { describe, it, expect } from "vitest";
import {
  parseWikilink,
  formatWikilink,
  dedupeWikilinkValue,
  type LinkResolver,
} from "../services/WikilinkDedup";

// A fake vault: every spelling that points at the same note shares an
// `id`, and `canonical` is the Obsidian-shortest form we want kept.
const RESOLVE: LinkResolver = (target) => {
  const map: Record<string, { id: string; canonical: string }> = {
    "Reise/Paris": { id: "Reise/Paris.md", canonical: "Paris" },
    Paris: { id: "Reise/Paris.md", canonical: "Paris" },
    "Reise/Rom": { id: "Reise/Rom.md", canonical: "Rom" },
    Rom: { id: "Reise/Rom.md", canonical: "Rom" },
    a: { id: "a.md", canonical: "a" },
    b: { id: "b.md", canonical: "b" },
  };
  return map[target] ?? null;
};

describe("parseWikilink", () => {
  it("parses a bare link", () => {
    expect(parseWikilink("[[Paris]]")).toEqual({
      target: "Paris",
      subpath: "",
      alias: null,
    });
  });

  it("keeps the folder path glued to the target", () => {
    expect(parseWikilink("[[Reise/Paris]]")).toEqual({
      target: "Reise/Paris",
      subpath: "",
      alias: null,
    });
  });

  it("captures the alias", () => {
    expect(parseWikilink("[[Reise/Paris|Stadt]]")).toEqual({
      target: "Reise/Paris",
      subpath: "",
      alias: "Stadt",
    });
  });

  it("captures a heading subpath", () => {
    expect(parseWikilink("[[Paris#Eiffel]]")).toEqual({
      target: "Paris",
      subpath: "#Eiffel",
      alias: null,
    });
  });

  it("captures subpath and alias together", () => {
    expect(parseWikilink("[[Paris#Eiffel|Turm]]")).toEqual({
      target: "Paris",
      subpath: "#Eiffel",
      alias: "Turm",
    });
  });

  it("trims whitespace inside the target", () => {
    expect(parseWikilink("[[  Paris  ]]")).toEqual({
      target: "Paris",
      subpath: "",
      alias: null,
    });
  });

  it("returns null for non-wikilink strings", () => {
    expect(parseWikilink("Paris")).toBeNull();
  });

  it("returns null for an empty target", () => {
    expect(parseWikilink("[[ ]]")).toBeNull();
  });

  it("returns null for an inline (non-whole-string) link", () => {
    expect(parseWikilink("see [[Foo]] now")).toBeNull();
  });
});

describe("formatWikilink", () => {
  it("formats a bare link", () => {
    expect(formatWikilink("Paris", "", null)).toBe("[[Paris]]");
  });
  it("formats a subpath link", () => {
    expect(formatWikilink("Paris", "#Eiffel", null)).toBe("[[Paris#Eiffel]]");
  });
  it("formats an aliased link", () => {
    expect(formatWikilink("Reise/Paris", "", "Stadt")).toBe(
      "[[Reise/Paris|Stadt]]",
    );
  });
  it("formats subpath plus alias", () => {
    expect(formatWikilink("Paris", "#Eiffel", "Turm")).toBe(
      "[[Paris#Eiffel|Turm]]",
    );
  });
});

describe("dedupeWikilinkValue", () => {
  it("collapses path-form + bare-form duplicates to the canonical form", () => {
    const r = dedupeWikilinkValue(["[[Reise/Paris]]", "[[Paris]]"], RESOLVE);
    expect(r.next).toEqual(["[[Paris]]"]);
    expect(r.changed).toBe(true);
    expect(r.removed).toHaveLength(1);
  });

  it("normalises a lone path-link to the canonical short form", () => {
    const r = dedupeWikilinkValue("[[Reise/Rom]]", RESOLVE);
    expect(r.next).toBe("[[Rom]]");
    expect(r.changed).toBe(true);
    expect(r.removed).toEqual([]);
    expect(r.rewritten).toEqual([{ from: "[[Reise/Rom]]", to: "[[Rom]]" }]);
  });

  it("leaves an already-canonical scalar untouched", () => {
    const r = dedupeWikilinkValue("[[Rom]]", RESOLVE);
    expect(r.next).toBe("[[Rom]]");
    expect(r.changed).toBe(false);
  });

  it("keeps distinct aliases that point at the same file", () => {
    const r = dedupeWikilinkValue(
      ["[[Reise/Paris|Stadt]]", "[[Paris]]"],
      RESOLVE,
    );
    expect(r.next).toEqual(["[[Paris|Stadt]]", "[[Paris]]"]);
    expect(r.changed).toBe(true);
    expect(r.removed).toEqual([]);
  });

  it("keeps distinct heading subpaths that point at the same file", () => {
    const r = dedupeWikilinkValue(["[[Paris#Eiffel]]", "[[Paris]]"], RESOLVE);
    expect(r.next).toEqual(["[[Paris#Eiffel]]", "[[Paris]]"]);
    expect(r.changed).toBe(false);
  });

  it("dedupes exact-duplicate broken links but keeps distinct ones", () => {
    expect(
      dedupeWikilinkValue(["[[Unknown]]", "[[Unknown]]"], RESOLVE).next,
    ).toEqual(["[[Unknown]]"]);
    const distinct = dedupeWikilinkValue(["[[Unknown]]", "[[Other]]"], RESOLVE);
    expect(distinct.next).toEqual(["[[Unknown]]", "[[Other]]"]);
    expect(distinct.changed).toBe(false);
  });

  it("leaves non-wikilink list items untouched", () => {
    const r = dedupeWikilinkValue(["plain", "[[Reise/Rom]]", "plain"], RESOLVE);
    expect(r.next).toEqual(["plain", "[[Rom]]", "plain"]);
    expect(r.changed).toBe(true);
  });

  it("preserves order, first occurrence wins", () => {
    const r = dedupeWikilinkValue(["[[b]]", "[[a]]", "[[b]]"], RESOLVE);
    expect(r.next).toEqual(["[[b]]", "[[a]]"]);
  });

  it("passes through values that hold no wikilinks", () => {
    expect(dedupeWikilinkValue("Reise", RESOLVE).changed).toBe(false);
    expect(dedupeWikilinkValue(42 as never, RESOLVE).changed).toBe(false);
  });
});
