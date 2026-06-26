import { describe, it, expect } from "vitest";
import {
  parseValue,
  splitList,
  mergeListValues,
} from "../services/ValueCoercion";

describe("parseValue auto", () => {
  it("parses numbers", () => {
    expect(parseValue("42")).toBe(42);
    expect(parseValue("3.14")).toBe(3.14);
  });
  it("parses booleans", () => {
    expect(parseValue("true")).toBe(true);
    expect(parseValue("False")).toBe(false);
  });
  it("parses null", () => {
    expect(parseValue("null")).toBeNull();
  });
  it("keeps wikilink strings as-is", () => {
    expect(parseValue("[[Some Note]]")).toBe("[[Some Note]]");
  });
  it("falls back to string", () => {
    expect(parseValue("hello world")).toBe("hello world");
  });
});

describe("parseValue typed", () => {
  it("forces string", () => {
    expect(parseValue("42", "string")).toBe("42");
  });
  it("forces list", () => {
    expect(parseValue("a, b, c", "list")).toEqual(["a", "b", "c"]);
  });
  it("wraps wikilink", () => {
    expect(parseValue("Some Note", "wikilink")).toBe("[[Some Note]]");
    expect(parseValue("[[Already]]", "wikilink")).toBe("[[Already]]");
  });
});

describe("splitList", () => {
  it("splits simple", () => {
    expect(splitList("a, b, c")).toEqual(["a", "b", "c"]);
  });
  it("respects quotes", () => {
    expect(splitList('"foo, bar", baz')).toEqual(["foo, bar", "baz"]);
  });
  it("respects brackets", () => {
    expect(splitList("[a, b], c")).toEqual(["[a, b]", "c"]);
  });
});

describe("mergeListValues", () => {
  it("merges and dedupes", () => {
    expect(mergeListValues(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });
  it("wraps scalars", () => {
    expect(mergeListValues("a", ["b"])).toEqual(["a", "b"]);
  });
});
