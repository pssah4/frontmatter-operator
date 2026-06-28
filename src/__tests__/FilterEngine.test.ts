import { describe, it, expect } from "vitest";
import { applyFilters, evaluateFilter } from "../services/FilterEngine";
import type { Filter, Frontmatter, NoteRow } from "../types";

function row(path: string, fm: Record<string, unknown>): NoteRow {
  return {
    file: { path } as never,
    path,
    basename: path.split("/").pop()!.replace(/\.md$/, ""),
    frontmatter: fm as Frontmatter,
  };
}

const ROWS: NoteRow[] = [
  row("People/Alice.md", { Kategorie: "Person", aliases: ["Al"], age: 33 }),
  row("People/Bob.md", { Kategorie: "Person", description: "engineer" }),
  row("Places/Berlin.md", { Kategorie: "Place" }),
  row("Notes/Random.md", { tags: ["misc"] }),
];

describe("evaluateFilter", () => {
  it("exists / not_exists", () => {
    const filter: Filter = {
      id: "1",
      property: "Kategorie",
      operator: "exists",
    };
    expect(ROWS.filter((r) => evaluateFilter(filter, r)).map((r) => r.path))
      .toEqual([
        "People/Alice.md",
        "People/Bob.md",
        "Places/Berlin.md",
      ]);

    const notExists: Filter = {
      id: "2",
      property: "Kategorie",
      operator: "not_exists",
    };
    expect(
      ROWS.filter((r) => evaluateFilter(notExists, r)).map((r) => r.path),
    ).toEqual(["Notes/Random.md"]);
  });

  it("equals with case insensitivity by default", () => {
    const filter: Filter = {
      id: "1",
      property: "Kategorie",
      operator: "equals",
      value: "person",
    };
    expect(
      ROWS.filter((r) => evaluateFilter(filter, r)).map((r) => r.path),
    ).toEqual(["People/Alice.md", "People/Bob.md"]);
  });

  it("equals case sensitive miss", () => {
    const filter: Filter = {
      id: "1",
      property: "Kategorie",
      operator: "equals",
      value: "person",
      caseSensitive: true,
    };
    expect(ROWS.filter((r) => evaluateFilter(filter, r))).toEqual([]);
  });

  it("contains across list", () => {
    const filter: Filter = {
      id: "1",
      property: "aliases",
      operator: "contains",
      value: "Al",
    };
    expect(
      ROWS.filter((r) => evaluateFilter(filter, r)).map((r) => r.path),
    ).toEqual(["People/Alice.md"]);
  });

  it("in_path", () => {
    const filter: Filter = {
      id: "1",
      property: "",
      operator: "in_path",
      value: "people/",
    };
    expect(
      ROWS.filter((r) => evaluateFilter(filter, r)).map((r) => r.path),
    ).toEqual(["People/Alice.md", "People/Bob.md"]);
  });

  it("matches_regex", () => {
    const filter: Filter = {
      id: "1",
      property: "description",
      operator: "matches_regex",
      value: "^eng",
    };
    expect(
      ROWS.filter((r) => evaluateFilter(filter, r)).map((r) => r.path),
    ).toEqual(["People/Bob.md"]);
  });

  it("is_empty treats missing as empty", () => {
    const filter: Filter = {
      id: "1",
      property: "description",
      operator: "is_empty",
    };
    expect(
      ROWS.filter((r) => evaluateFilter(filter, r)).map((r) => r.path),
    ).toEqual(["People/Alice.md", "Places/Berlin.md", "Notes/Random.md"]);
  });
});

describe("applyFilters", () => {
  it("AND combinator", () => {
    const filters: Filter[] = [
      { id: "1", property: "Kategorie", operator: "equals", value: "Person" },
      { id: "2", property: "age", operator: "exists" },
    ];
    expect(applyFilters(ROWS, filters, "AND").map((r) => r.path)).toEqual([
      "People/Alice.md",
    ]);
  });

  it("OR combinator", () => {
    const filters: Filter[] = [
      { id: "1", property: "Kategorie", operator: "equals", value: "Place" },
      { id: "2", property: "tags", operator: "exists" },
    ];
    expect(applyFilters(ROWS, filters, "OR").map((r) => r.path)).toEqual([
      "Places/Berlin.md",
      "Notes/Random.md",
    ]);
  });

  it("empty filters returns all", () => {
    expect(applyFilters(ROWS, [], "AND")).toHaveLength(ROWS.length);
  });
});

describe("evaluateFilter -- virtual properties", () => {
  // Build a row that exposes a `parent` on the synthetic file so the
  // VirtualProperties resolver can read it (mirrors what
  // FrontmatterScanner.buildAllRows produces in production).
  function vrow(path: string, ext = "md"): NoteRow {
    const last = path.split("/").pop()!;
    const basename = last.replace(/\.[^.]+$/, "");
    const parentPath = path.includes("/")
      ? path.slice(0, path.lastIndexOf("/"))
      : "";
    return {
      file: {
        path,
        basename,
        extension: ext,
        parent: path.includes("/") ? { path: parentPath } : null,
      } as never,
      path,
      basename,
      frontmatter: {},
    };
  }

  const VIRTUAL_ROWS = [
    vrow("notes/area/topic.md"),
    vrow("notes/area/other.md"),
    vrow("notes/different/file.md"),
    vrow("at-root.md"),
  ];

  it("equals on __folder", () => {
    const f: Filter = {
      id: "1",
      property: "__folder",
      operator: "equals",
      value: "notes/area",
    };
    expect(
      VIRTUAL_ROWS.filter((r) => evaluateFilter(f, r)).map((r) => r.path),
    ).toEqual(["notes/area/topic.md", "notes/area/other.md"]);
  });

  it("contains on __folder", () => {
    const f: Filter = {
      id: "1",
      property: "__folder",
      operator: "contains",
      value: "area",
    };
    expect(
      VIRTUAL_ROWS.filter((r) => evaluateFilter(f, r)).map((r) => r.path),
    ).toEqual(["notes/area/topic.md", "notes/area/other.md"]);
  });

  it("equals on __filename", () => {
    const f: Filter = {
      id: "1",
      property: "__filename",
      operator: "equals",
      value: "topic",
    };
    expect(
      VIRTUAL_ROWS.filter((r) => evaluateFilter(f, r)).map((r) => r.path),
    ).toEqual(["notes/area/topic.md"]);
  });

  it("equals on __extension matches md notes", () => {
    const f: Filter = {
      id: "1",
      property: "__extension",
      operator: "equals",
      value: "md",
    };
    expect(VIRTUAL_ROWS.filter((r) => evaluateFilter(f, r))).toHaveLength(4);
  });

  it("exists on __folder is true for root-level notes (empty string IS a value)", () => {
    // VirtualProperties.resolve never returns undefined for __folder
    // (root notes resolve to ""), so 'exists' is true everywhere.
    const f: Filter = { id: "1", property: "__folder", operator: "exists" };
    expect(VIRTUAL_ROWS.filter((r) => evaluateFilter(f, r))).toHaveLength(4);
  });

  it("is_empty on __folder catches vault-root notes", () => {
    const f: Filter = {
      id: "1",
      property: "__folder",
      operator: "is_empty",
    };
    expect(
      VIRTUAL_ROWS.filter((r) => evaluateFilter(f, r)).map((r) => r.path),
    ).toEqual(["at-root.md"]);
  });

  it("in_path stays based on row.path, not filter.property", () => {
    // Regression: in_path must not accidentally read the virtual value
    // for the property -- it's the only operator that's
    // property-agnostic.
    const f: Filter = {
      id: "1",
      property: "__folder",
      operator: "in_path",
      value: "different",
    };
    expect(
      VIRTUAL_ROWS.filter((r) => evaluateFilter(f, r)).map((r) => r.path),
    ).toEqual(["notes/different/file.md"]);
  });
});
