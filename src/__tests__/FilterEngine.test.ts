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
