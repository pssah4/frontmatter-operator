/**
 * VirtualProperties -- registry of name-only path-derived columns.
 * Tests cover: registration, isVirtual prefix-check, per-virtual
 * resolvers for vault-root + nested + deep paths, inventory entry
 * shape.
 */

import { describe, it, expect } from "vitest";
import { VirtualProperties } from "../services/VirtualProperties";
import type { NoteRow } from "../types";

interface FakeFile {
  path: string;
  basename: string;
  extension: string;
  parent: { path: string } | null;
}

function row(path: string, ext = "md"): NoteRow {
  const last = path.split("/").pop() ?? path;
  const basename = last.replace(/\.[^.]+$/, "");
  const parentPath = path.includes("/")
    ? path.slice(0, path.lastIndexOf("/"))
    : "";
  const file: FakeFile = {
    path,
    basename,
    extension: ext,
    parent: path.includes("/") ? { path: parentPath } : null,
  };
  return {
    path,
    basename,
    file: file as unknown as NoteRow["file"],
    frontmatter: {},
  };
}

describe("VirtualProperties.isVirtual", () => {
  it("returns true for the three v1 virtuals", () => {
    expect(VirtualProperties.isVirtual("__folder")).toBe(true);
    expect(VirtualProperties.isVirtual("__filename")).toBe(true);
    expect(VirtualProperties.isVirtual("__extension")).toBe(true);
  });

  it("returns false for real frontmatter keys", () => {
    expect(VirtualProperties.isVirtual("tags")).toBe(false);
    expect(VirtualProperties.isVirtual("aliases")).toBe(false);
    expect(VirtualProperties.isVirtual("description")).toBe(false);
    expect(VirtualProperties.isVirtual("")).toBe(false);
  });

  it("returns false for unknown __-prefixed names (registry, not prefix)", () => {
    expect(VirtualProperties.isVirtual("__custom")).toBe(false);
    expect(VirtualProperties.isVirtual("__")).toBe(false);
  });
});

describe("VirtualProperties.resolve -- __folder", () => {
  it("returns the immediate parent path for a nested note", () => {
    expect(
      VirtualProperties.resolve("__folder", row("notes/area/topic/x.md")),
    ).toBe("notes/area/topic");
  });

  it("returns empty string for a vault-root note", () => {
    expect(VirtualProperties.resolve("__folder", row("at-root.md"))).toBe("");
  });

  it("returns the single segment for a one-level note", () => {
    expect(VirtualProperties.resolve("__folder", row("notes/x.md"))).toBe("notes");
  });
});

describe("VirtualProperties.resolve -- __filename", () => {
  it("returns the basename without extension", () => {
    expect(VirtualProperties.resolve("__filename", row("notes/abc.md"))).toBe("abc");
    expect(VirtualProperties.resolve("__filename", row("root.md"))).toBe("root");
  });

  it("handles dotted basenames correctly", () => {
    expect(
      VirtualProperties.resolve("__filename", row("notes/v1.2.3-meta.md")),
    ).toBe("v1.2.3-meta");
  });
});

describe("VirtualProperties.resolve -- __extension", () => {
  it("returns 'md' for normal notes", () => {
    expect(VirtualProperties.resolve("__extension", row("notes/x.md"))).toBe("md");
  });

  it("returns the actual extension for non-md", () => {
    expect(
      VirtualProperties.resolve("__extension", row("notes/board.canvas", "canvas")),
    ).toBe("canvas");
  });
});

describe("VirtualProperties.resolve -- unknown id", () => {
  it("returns undefined for unregistered names", () => {
    expect(
      VirtualProperties.resolve("not-a-virtual", row("notes/x.md")),
    ).toBeUndefined();
  });
});

describe("VirtualProperties.asInventoryEntries", () => {
  it("returns one entry per registered virtual", () => {
    const entries = VirtualProperties.asInventoryEntries(0);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.name).sort()).toEqual([
      "__extension",
      "__filename",
      "__folder",
    ]);
  });

  it("uses the supplied row count for every entry", () => {
    const entries = VirtualProperties.asInventoryEntries(142);
    for (const e of entries) {
      expect(e.count).toBe(142);
    }
  });

  it("each entry has a string-typed types Set and an empty sampleValues", () => {
    const entries = VirtualProperties.asInventoryEntries(1);
    for (const e of entries) {
      expect(e.sampleValues).toEqual([]);
      expect(e.types.has("string")).toBe(true);
      expect(e.types.size).toBe(1);
    }
  });
});

describe("VirtualProperties.all + get", () => {
  it("all() returns the three v1 virtuals", () => {
    const all = VirtualProperties.all();
    expect(all.map((v) => v.id).sort()).toEqual([
      "__extension",
      "__filename",
      "__folder",
    ]);
    for (const v of all) {
      expect(v.editable).toBe(false);
      expect(v.group).toBe("Note metadata");
    }
  });

  it("get returns the registered virtual", () => {
    const v = VirtualProperties.get("__folder");
    expect(v?.label).toBe("Folder");
    expect(v?.icon).toBe("folder");
  });

  it("get returns undefined for unknown name", () => {
    expect(VirtualProperties.get("nope")).toBeUndefined();
  });
});
