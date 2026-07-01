import { describe, it, expect } from "vitest";
import {
  resolvePropertyEditKind,
  type ObservedValueType,
} from "../services/propertyEditKind";

function observed(...t: ObservedValueType[]): Set<ObservedValueType> {
  return new Set(t);
}

describe("resolvePropertyEditKind", () => {
  it("the bug case: empty/string cell of a list property still edits as list", () => {
    // `type` observed as a list somewhere in the vault -> always list,
    // regardless of a single note having it empty or as a bare string.
    expect(resolvePropertyEditKind(undefined, observed("list"))).toBe("list");
    expect(resolvePropertyEditKind(undefined, observed("list", "string", "null"))).toBe("list");
  });

  it("honours Obsidian's declared list types over observed scalars", () => {
    expect(resolvePropertyEditKind("multitext", observed("string"))).toBe("list");
    expect(resolvePropertyEditKind("tags", observed("string"))).toBe("list");
    expect(resolvePropertyEditKind("aliases", undefined)).toBe("list");
    expect(resolvePropertyEditKind("cssclasses", undefined)).toBe("list");
  });

  it("maps the scalar Obsidian types", () => {
    expect(resolvePropertyEditKind("number", undefined)).toBe("number");
    expect(resolvePropertyEditKind("checkbox", undefined)).toBe("boolean");
    expect(resolvePropertyEditKind("text", observed("list"))).toBe("text");
    expect(resolvePropertyEditKind("date", undefined)).toBe("text");
    expect(resolvePropertyEditKind("datetime", undefined)).toBe("text");
  });

  it("falls back to observed types when Obsidian type is unknown/absent", () => {
    expect(resolvePropertyEditKind("unknown", observed("number"))).toBe("number");
    expect(resolvePropertyEditKind(undefined, observed("number"))).toBe("number");
    expect(resolvePropertyEditKind(undefined, observed("boolean"))).toBe("boolean");
    expect(resolvePropertyEditKind(undefined, observed("string"))).toBe("text");
  });

  it("treats mixed scalar observations as free text", () => {
    expect(resolvePropertyEditKind(undefined, observed("string", "number"))).toBe("text");
    expect(resolvePropertyEditKind(undefined, observed("number", "boolean"))).toBe("text");
  });

  it("ignores nulls when judging observed types", () => {
    expect(resolvePropertyEditKind(undefined, observed("number", "null"))).toBe("number");
    expect(resolvePropertyEditKind(undefined, observed("null"))).toBeUndefined();
  });

  it("gives no preference for objects or no signal (value-based fallback)", () => {
    expect(resolvePropertyEditKind(undefined, observed("object"))).toBeUndefined();
    expect(resolvePropertyEditKind(undefined, undefined)).toBeUndefined();
    expect(resolvePropertyEditKind(undefined, observed())).toBeUndefined();
  });
});
