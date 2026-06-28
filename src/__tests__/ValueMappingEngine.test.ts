/**
 * ValueMappingEngine -- the pure data-transformation core that powers
 * the unified Copy/Move Transfer action. Covers:
 *  - identity (no transforms, no mappings) -> input unchanged
 *  - single + chained transforms
 *  - scalar + list element-wise mapping
 *  - many-to-one collapse with dedup
 *  - wikilink unwrap + re-wrap
 *  - non-string scalars (numbers/booleans)
 *  - empty-string mapping = deletion of that list element
 */

import { describe, it, expect } from "vitest";
import {
  applyTransforms,
  isWikilink,
  lookupMapping,
  mapFmValue,
  unwrapWikilink,
} from "../services/ValueMappingEngine";
import type { ValueMapping, ValueTransform } from "../types";

const map = (s: string, t: string): ValueMapping => ({
  source: s,
  target: t,
  userEdited: true,
});

describe("applyTransforms", () => {
  it("returns input unchanged when transform list is empty", () => {
    expect(applyTransforms("Zettel", [])).toBe("Zettel");
  });

  it("applies trim", () => {
    expect(applyTransforms("  Zettel  ", ["trim"])).toBe("Zettel");
  });

  it("applies lowercase", () => {
    expect(applyTransforms("Zettel", ["lowercase"])).toBe("zettel");
  });

  it("applies titlecase (lowercases the rest)", () => {
    expect(applyTransforms("ich BIN da", ["titlecase"])).toBe("Ich Bin Da");
  });

  it("strips combining diacritics", () => {
    expect(applyTransforms("Über", ["strip_diacritics"])).toBe("Uber");
    expect(applyTransforms("éàü", ["strip_diacritics"])).toBe("eau");
  });

  it("applies transforms left-to-right", () => {
    // trim THEN lowercase
    expect(applyTransforms("  HELLO  ", ["trim", "lowercase"])).toBe("hello");
    // lowercase THEN trim still works
    expect(applyTransforms("  HELLO  ", ["lowercase", "trim"])).toBe("hello");
  });
});

describe("lookupMapping", () => {
  it("returns undefined when no mapping matches", () => {
    expect(lookupMapping("Zettel", [map("foo", "bar")])).toBeUndefined();
  });

  it("returns the first matching target", () => {
    const mappings = [map("Zettel", "zettel"), map("Zettel", "OTHER")];
    expect(lookupMapping("Zettel", mappings)).toBe("zettel");
  });

  it("is case-sensitive on the post-transform source", () => {
    expect(lookupMapping("zettel", [map("Zettel", "X")])).toBeUndefined();
  });
});

describe("unwrapWikilink + isWikilink", () => {
  it("unwraps [[Foo]] -> Foo", () => {
    expect(unwrapWikilink("[[Foo]]")).toBe("Foo");
    expect(isWikilink("[[Foo]]")).toBe(true);
  });

  it("unwraps [[Foo|Alias]] -> Foo (mapping uses link target, not alias)", () => {
    expect(unwrapWikilink("[[Foo|Bar]]")).toBe("Foo");
    expect(isWikilink("[[Foo|Bar]]")).toBe(true);
  });

  it("leaves plain text unchanged", () => {
    expect(unwrapWikilink("plain")).toBe("plain");
    expect(isWikilink("plain")).toBe(false);
  });

  it("does not unwrap partial markup", () => {
    expect(unwrapWikilink("[[broken")).toBe("[[broken");
    expect(isWikilink("[[broken")).toBe(false);
  });
});

describe("mapFmValue scalar", () => {
  it("identity: no transforms, no mappings -> input unchanged", () => {
    expect(mapFmValue("Zettel", [], [])).toBe("Zettel");
  });

  it("transform-only rewrites the value", () => {
    expect(mapFmValue("Zettel", ["lowercase"], [])).toBe("zettel");
  });

  it("explicit mapping wins over transform-only fallback", () => {
    // user typed "ZETTEL" as target, transform would have lowered to "zettel"
    expect(
      mapFmValue("Zettel", ["lowercase"], [map("zettel", "ZETTEL")]),
    ).toBe("ZETTEL");
  });

  it("preserves wikilink wrapping on rewrite", () => {
    expect(mapFmValue("[[Person]]", [], [map("Person", "person")])).toBe(
      "[[person]]",
    );
  });

  it("unwraps wikilink for matching, re-wraps for output", () => {
    expect(
      mapFmValue("[[Person|alias]]", ["lowercase"], []),
    ).toBe("[[person]]");
  });

  it("non-string scalar passes through when no transform/mapping fires", () => {
    expect(mapFmValue(42 as never, [], [])).toBe(42);
    expect(mapFmValue(true as never, [], [])).toBe(true);
  });

  it("numeric scalar can be mapped (target stays string per design)", () => {
    expect(mapFmValue(42 as never, [], [map("42", "answer")])).toBe("answer");
  });

  it("null and undefined pass through", () => {
    expect(mapFmValue(null as never, ["lowercase"], [])).toBeNull();
    expect(mapFmValue(undefined as never, ["lowercase"], [])).toBeUndefined();
  });

  it("plain object scalar is not touched (v1 limitation)", () => {
    const obj = { topics: ["a"] };
    expect(mapFmValue(obj as never, ["lowercase"], [])).toBe(obj);
  });
});

describe("mapFmValue list", () => {
  it("maps each element + dedups many-to-one collapses", () => {
    const input = ["Person", "Teilnehmer", "Person"];
    const mappings = [map("Person", "person"), map("Teilnehmer", "person")];
    // ["person", "person", "person"] -> dedup -> ["person"]
    expect(mapFmValue(input, [], mappings)).toEqual(["person"]);
  });

  it("drops elements whose target is the empty string", () => {
    const input = ["keep", "drop", "also-keep"];
    const mappings = [map("drop", "")];
    expect(mapFmValue(input, [], mappings)).toEqual(["keep", "also-keep"]);
  });

  it("applies transforms before mapping per element", () => {
    const input = ["Zettel", "ZETTEL"];
    const transforms: ValueTransform[] = ["lowercase"];
    // both lowercase to "zettel" -> dedup -> ["zettel"]
    expect(mapFmValue(input, transforms, [])).toEqual(["zettel"]);
  });

  it("respects wikilink elements in lists", () => {
    const input = ["[[Person]]", "Teilnehmer"];
    const mappings = [
      map("Person", "person"),
      map("Teilnehmer", "person"),
    ];
    // [[Person]] -> [[person]]; "Teilnehmer" -> "person"
    // -> ["[[person]]", "person"] -- different string keys, no dedup
    const out = mapFmValue(input, [], mappings) as string[];
    expect(out).toEqual(["[[person]]", "person"]);
  });

  it("empty list stays empty", () => {
    expect(mapFmValue([], ["lowercase"], [])).toEqual([]);
  });
});

describe("end-to-end pipeline", () => {
  it("Zettel + zettel via lowercase + identity-map -> zettel", () => {
    const r1 = mapFmValue("Zettel", ["lowercase"], []);
    const r2 = mapFmValue("zettel", ["lowercase"], []);
    expect(r1).toBe("zettel");
    expect(r2).toBe("zettel");
  });

  it("Person/Teilnehmer many-to-one with transforms", () => {
    const mappings = [
      map("person", "person"),
      map("teilnehmer", "person"),
    ];
    const transforms: ValueTransform[] = ["trim", "lowercase"];
    const input = ["  Person  ", "Teilnehmer", "person"];
    expect(mapFmValue(input, transforms, mappings)).toEqual(["person"]);
  });
});
