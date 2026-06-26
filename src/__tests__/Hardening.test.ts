import { describe, it, expect } from "vitest";
import {
  isValidSnapshotId,
  parseSnapshot,
} from "../services/SnapshotService";
import { isRegexAllowed } from "../services/FilterEngine";
import { validateNoteSelector } from "../api/FrontmatterEditorAPI";

describe("HARD-01: snapshot id validation", () => {
  it("accepts well-formed ids", () => {
    expect(isValidSnapshotId("20260627-103045-ab12")).toBe(true);
    expect(isValidSnapshotId("20260101-000000-abcd1234")).toBe(true);
  });
  it("rejects path traversal attempts", () => {
    expect(isValidSnapshotId("../../etc/passwd")).toBe(false);
    expect(isValidSnapshotId("../../.obsidian/workspace")).toBe(false);
    expect(isValidSnapshotId("20260627-103045-../boom")).toBe(false);
  });
  it("rejects non-strings and empties", () => {
    expect(isValidSnapshotId("")).toBe(false);
    expect(isValidSnapshotId(undefined)).toBe(false);
    expect(isValidSnapshotId(42 as never)).toBe(false);
    expect(isValidSnapshotId(null as never)).toBe(false);
  });
  it("rejects too-short or wrong-format ids", () => {
    expect(isValidSnapshotId("abc")).toBe(false);
    expect(isValidSnapshotId("20260627-103045")).toBe(false);
    expect(isValidSnapshotId("20260627-103045-")).toBe(false);
  });
});

describe("HARD-02: snapshot shape validation", () => {
  const validSnap = {
    id: "20260627-103045-ab12",
    createdAt: "2026-06-27T10:30:45.000Z",
    action: { type: "set", property: "x", value: "y", mode: "overwrite" },
    entries: [{ path: "Notes/A.md", before: { foo: "bar" } }],
  };

  it("accepts a valid snapshot shape", () => {
    expect(parseSnapshot(validSnap)).not.toBeNull();
  });

  it("rejects when id is malformed", () => {
    expect(parseSnapshot({ ...validSnap, id: "../escape" })).toBeNull();
  });

  it("rejects when action.type is unknown", () => {
    expect(
      parseSnapshot({ ...validSnap, action: { type: "evil" } }),
    ).toBeNull();
  });

  it("rejects when entries is not an array", () => {
    expect(parseSnapshot({ ...validSnap, entries: "nope" })).toBeNull();
  });

  it("rejects when an entry.path is empty", () => {
    expect(
      parseSnapshot({
        ...validSnap,
        entries: [{ path: "", before: {} }],
      }),
    ).toBeNull();
  });

  it("rejects when entry.before is a primitive", () => {
    expect(
      parseSnapshot({
        ...validSnap,
        entries: [{ path: "ok.md", before: "string-not-object" }],
      }),
    ).toBeNull();
  });

  it("accepts entry.before = null", () => {
    expect(
      parseSnapshot({
        ...validSnap,
        entries: [{ path: "ok.md", before: null }],
      }),
    ).not.toBeNull();
  });

  it("rejects when createdAt is not a valid date", () => {
    expect(parseSnapshot({ ...validSnap, createdAt: "garbage" })).toBeNull();
  });

  it("rejects non-objects", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot(undefined)).toBeNull();
    expect(parseSnapshot("string")).toBeNull();
    expect(parseSnapshot(42)).toBeNull();
  });
});

describe("HARD-03: regex length guard", () => {
  it("accepts normal regexes", () => {
    expect(isRegexAllowed("^Reise")).toBe(true);
    expect(isRegexAllowed("(travel|reise)")).toBe(true);
  });
  it("rejects empty regex", () => {
    expect(isRegexAllowed("")).toBe(false);
  });
  it("rejects regex source over 200 chars", () => {
    expect(isRegexAllowed("a".repeat(201))).toBe(false);
    expect(isRegexAllowed("a".repeat(200))).toBe(true);
  });
});

describe("HARD-06: NoteSelector validator", () => {
  it("accepts kind=all", () => {
    expect(validateNoteSelector({ kind: "all" })).toEqual({ kind: "all" });
  });

  it("accepts kind=paths with string array", () => {
    const out = validateNoteSelector({
      kind: "paths",
      paths: ["a.md", "b.md"],
    });
    expect(out).toEqual({ kind: "paths", paths: ["a.md", "b.md"] });
  });

  it("rejects kind=paths without paths array", () => {
    expect(() =>
      validateNoteSelector({ kind: "paths" } as never),
    ).toThrow(/paths/);
  });

  it("rejects kind=paths with non-string entries", () => {
    expect(() =>
      validateNoteSelector({ kind: "paths", paths: [42 as never] }),
    ).toThrow(/non-empty strings/);
  });

  it("accepts kind=filter with valid conditions", () => {
    const out = validateNoteSelector({
      kind: "filter",
      conditions: [
        { property: "Thema", operator: "equals", value: "Reise" },
      ],
      combinator: "AND",
    });
    expect(out.kind).toBe("filter");
  });

  it("rejects kind=filter with unknown operator", () => {
    expect(() =>
      validateNoteSelector({
        kind: "filter",
        conditions: [
          { property: "x", operator: "spooky" as never, value: "y" },
        ],
      }),
    ).toThrow(/operator/);
  });

  it("rejects kind=filter with bad combinator", () => {
    expect(() =>
      validateNoteSelector({
        kind: "filter",
        conditions: [],
        combinator: "XOR" as never,
      }),
    ).toThrow(/combinator/);
  });

  it("rejects unknown kind", () => {
    expect(() =>
      validateNoteSelector({ kind: "evil" } as never),
    ).toThrow(/kind/);
  });

  it("rejects non-objects", () => {
    expect(() => validateNoteSelector(null)).toThrow();
    expect(() => validateNoteSelector("string" as never)).toThrow();
  });
});
