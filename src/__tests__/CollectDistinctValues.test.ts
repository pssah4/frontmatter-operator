/**
 * collectDistinctValues -- the helper that feeds the Transfer modal's
 * value-mapping table with distinct source-value rows + occurrence
 * counts. The constructor takes an App, but the method body only
 * touches the `rows` argument, so we can exercise it with a mock App.
 */

import { describe, it, expect } from "vitest";
import { FrontmatterScanner } from "../services/FrontmatterScanner";
import type { NoteRow } from "../types";

function row(path: string, fm: Record<string, unknown>): NoteRow {
  return {
    path,
    basename: path.replace(/^.*\//, "").replace(/\.md$/, ""),
    frontmatter: fm as NoteRow["frontmatter"],
    file: { path } as unknown as NoteRow["file"],
  };
}

function makeScanner(): FrontmatterScanner {
  // collectDistinctValues never touches `this.app`, so a stub is fine.
  return new FrontmatterScanner({} as never);
}

describe("FrontmatterScanner.collectDistinctValues", () => {
  it("returns empty for empty input", () => {
    expect(makeScanner().collectDistinctValues([], ["x"])).toEqual([]);
  });

  it("counts scalar values across one property", () => {
    const rows = [
      row("a.md", { Kategorie: "Zettel" }),
      row("b.md", { Kategorie: "Zettel" }),
      row("c.md", { Kategorie: "Person" }),
    ];
    expect(
      makeScanner().collectDistinctValues(rows, ["Kategorie"]),
    ).toEqual([
      { value: "Zettel", count: 2 },
      { value: "Person", count: 1 },
    ]);
  });

  it("flattens list values element-wise", () => {
    const rows = [
      row("a.md", { tags: ["a", "b", "c"] }),
      row("b.md", { tags: ["a", "a"] }),
    ];
    expect(makeScanner().collectDistinctValues(rows, ["tags"])).toEqual([
      { value: "a", count: 3 },
      { value: "b", count: 1 },
      { value: "c", count: 1 },
    ]);
  });

  it("counts across multiple source properties", () => {
    const rows = [
      row("a.md", { Rolle: "Person", Beteiligte: "Teilnehmer" }),
      row("b.md", { Rolle: "Person" }),
    ];
    expect(
      makeScanner().collectDistinctValues(rows, ["Rolle", "Beteiligte"]),
    ).toEqual([
      { value: "Person", count: 2 },
      { value: "Teilnehmer", count: 1 },
    ]);
  });

  it("unwraps wikilinks so '[[Person]]' and 'Person' merge", () => {
    const rows = [
      row("a.md", { ref: "[[Person]]" }),
      row("b.md", { ref: "Person" }),
      row("c.md", { ref: "[[Person|alias]]" }),
    ];
    expect(makeScanner().collectDistinctValues(rows, ["ref"])).toEqual([
      { value: "Person", count: 3 },
    ]);
  });

  it("stringifies non-string scalars", () => {
    const rows = [
      row("a.md", { year: 2026 }),
      row("b.md", { year: 2026 }),
      row("c.md", { year: 2025 }),
    ];
    expect(makeScanner().collectDistinctValues(rows, ["year"])).toEqual([
      { value: "2026", count: 2 },
      { value: "2025", count: 1 },
    ]);
  });

  it("skips null / undefined / empty string", () => {
    const rows = [
      row("a.md", { tag: "x" }),
      row("b.md", { tag: null }),
      row("c.md", { tag: "" }),
      row("d.md", {}),
    ];
    expect(makeScanner().collectDistinctValues(rows, ["tag"])).toEqual([
      { value: "x", count: 1 },
    ]);
  });

  it("ignores plain-object values (not v1-mappable)", () => {
    const rows = [
      row("a.md", { moc: { topics: ["x"], concepts: [] } }),
      row("b.md", { moc: "fallback" }),
    ];
    expect(makeScanner().collectDistinctValues(rows, ["moc"])).toEqual([
      { value: "fallback", count: 1 },
    ]);
  });

  it("sorts by count desc, then locale asc", () => {
    const rows = [
      row("a.md", { x: "B" }),
      row("b.md", { x: "A" }),
      row("c.md", { x: "A" }),
      row("d.md", { x: "C" }),
    ];
    const out = makeScanner().collectDistinctValues(rows, ["x"]);
    expect(out).toEqual([
      { value: "A", count: 2 },
      { value: "B", count: 1 },
      { value: "C", count: 1 },
    ]);
  });
});
