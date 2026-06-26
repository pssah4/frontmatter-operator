import { describe, it, expect } from "vitest";
import { applyActionPure } from "../services/BulkActionService";

describe("applyActionPure", () => {
  describe("set", () => {
    it("overwrites by default", () => {
      const out = applyActionPure(
        { foo: "old" },
        { type: "set", property: "foo", value: "new", mode: "overwrite" },
      );
      expect(out.changed).toBe(true);
      expect(out.after.foo).toBe("new");
    });

    it("skips when property exists and mode=skip_if_exists", () => {
      const out = applyActionPure(
        { foo: "old" },
        {
          type: "set",
          property: "foo",
          value: "new",
          mode: "skip_if_exists",
        },
      );
      expect(out.changed).toBe(false);
      expect(out.after.foo).toBe("old");
      expect(out.skipped).toBeDefined();
    });

    it("merges list values when mode=merge_list", () => {
      const out = applyActionPure(
        { tags: ["a", "b"] },
        {
          type: "set",
          property: "tags",
          value: ["b", "c"],
          mode: "merge_list",
        },
      );
      expect(out.changed).toBe(true);
      expect(out.after.tags).toEqual(["a", "b", "c"]);
    });

    it("adds new property when absent", () => {
      const out = applyActionPure(
        { other: 1 },
        { type: "set", property: "type", value: "person", mode: "overwrite" },
      );
      expect(out.changed).toBe(true);
      expect(out.after.type).toBe("person");
    });
  });

  describe("delete", () => {
    it("removes property", () => {
      const out = applyActionPure(
        { foo: "bar", keep: 1 },
        { type: "delete", property: "foo" },
      );
      expect(out.changed).toBe(true);
      expect(out.after.foo).toBeUndefined();
      expect(out.after.keep).toBe(1);
    });

    it("skips when property absent", () => {
      const out = applyActionPure(
        { keep: 1 },
        { type: "delete", property: "foo" },
      );
      expect(out.changed).toBe(false);
    });
  });

  describe("set with template", () => {
    it("resolves single-substitution template to raw value", () => {
      const out = applyActionPure(
        { Thema: "Reise", other: 1 },
        {
          type: "set",
          property: "moc",
          value: "{{Thema}}",
          mode: "overwrite",
          template: true,
        },
      );
      expect(out.changed).toBe(true);
      expect(out.after.moc).toBe("Reise");
    });

    it("preserves list type for single substitution", () => {
      const out = applyActionPure(
        { tags: ["a", "b", "c"] },
        {
          type: "set",
          property: "topics",
          value: "{{tags}}",
          mode: "overwrite",
          template: true,
        },
      );
      expect(out.after.topics).toEqual(["a", "b", "c"]);
    });

    it("concatenates multi-substitution to string", () => {
      const out = applyActionPure(
        { first: "John", last: "Doe" },
        {
          type: "set",
          property: "display",
          value: "{{first}} {{last}}",
          mode: "overwrite",
          template: true,
        },
      );
      expect(out.after.display).toBe("John Doe");
    });

    it("skips when template resolves to empty", () => {
      const out = applyActionPure(
        { other: 1 },
        {
          type: "set",
          property: "moc",
          value: "{{missing}}",
          mode: "overwrite",
          template: true,
        },
      );
      expect(out.changed).toBe(false);
    });
  });

  describe("rename / copy / move", () => {
    it("rename moves value and removes source", () => {
      const out = applyActionPure(
        { Beschreibung: "[[Note]]" },
        {
          type: "rename",
          fromProperties: ["Beschreibung"],
          toProperty: "description",
          onConflict: "skip",
        },
      );
      expect(out.after.description).toBe("[[Note]]");
      expect(out.after.Beschreibung).toBeUndefined();
    });

    it("rename preserves wikilink lists", () => {
      const out = applyActionPure(
        { Beschreibung: ["[[A]]", "[[B]]"] },
        {
          type: "rename",
          fromProperties: ["Beschreibung"],
          toProperty: "description",
          onConflict: "skip",
        },
      );
      expect(out.after.description).toEqual(["[[A]]", "[[B]]"]);
    });

    it("copy keeps source", () => {
      const out = applyActionPure(
        { from: "x" },
        {
          type: "copy",
          fromProperties: ["from"],
          toProperty: "to",
          onConflict: "skip",
        },
      );
      expect(out.after.from).toBe("x");
      expect(out.after.to).toBe("x");
    });

    it("skip on conflict", () => {
      const out = applyActionPure(
        { from: "x", to: "y" },
        {
          type: "rename",
          fromProperties: ["from"],
          toProperty: "to",
          onConflict: "skip",
        },
      );
      expect(out.changed).toBe(false);
      expect(out.after.from).toBe("x");
      expect(out.after.to).toBe("y");
    });

    it("overwrite on conflict", () => {
      const out = applyActionPure(
        { from: "x", to: "y" },
        {
          type: "move",
          fromProperties: ["from"],
          toProperty: "to",
          onConflict: "overwrite",
        },
      );
      expect(out.after.from).toBeUndefined();
      expect(out.after.to).toBe("x");
    });

    it("merge_list on conflict", () => {
      const out = applyActionPure(
        { from: ["c", "d"], to: ["a", "b"] },
        {
          type: "copy",
          fromProperties: ["from"],
          toProperty: "to",
          onConflict: "merge_list",
        },
      );
      expect(out.after.to).toEqual(["a", "b", "c", "d"]);
      expect(out.after.from).toEqual(["c", "d"]);
    });

    it("skips when source absent", () => {
      const out = applyActionPure(
        { foo: 1 },
        {
          type: "rename",
          fromProperties: ["missing"],
          toProperty: "target",
          onConflict: "skip",
        },
      );
      expect(out.changed).toBe(false);
    });
  });

  describe("multi-source rename / copy / move", () => {
    it("rename merges three sources into one target and deletes sources", () => {
      const out = applyActionPure(
        { Beschreibung: "alt-de", Description: "alt-en", descr: "alt-old" },
        {
          type: "rename",
          fromProperties: ["Beschreibung", "Description", "descr"],
          toProperty: "description",
          onConflict: "skip",
        },
      );
      expect(out.after.description).toEqual(["alt-de", "alt-en", "alt-old"]);
      expect(out.after.Beschreibung).toBeUndefined();
      expect(out.after.Description).toBeUndefined();
      expect(out.after.descr).toBeUndefined();
    });

    it("copy multi-source keeps all sources", () => {
      const out = applyActionPure(
        { Vorname: "Anna", Nachname: "Doe" },
        {
          type: "copy",
          fromProperties: ["Vorname", "Nachname"],
          toProperty: "names",
          onConflict: "skip",
        },
      );
      expect(out.after.names).toEqual(["Anna", "Doe"]);
      expect(out.after.Vorname).toBe("Anna");
      expect(out.after.Nachname).toBe("Doe");
    });

    it("merges lists across sources without duplicates", () => {
      const out = applyActionPure(
        { tagsDe: ["a", "b"], tagsEn: ["b", "c"] },
        {
          type: "move",
          fromProperties: ["tagsDe", "tagsEn"],
          toProperty: "tags",
          onConflict: "skip",
        },
      );
      expect(out.after.tags).toEqual(["a", "b", "c"]);
      expect(out.after.tagsDe).toBeUndefined();
      expect(out.after.tagsEn).toBeUndefined();
    });

    it("skips when none of the sources exist", () => {
      const out = applyActionPure(
        { other: 1 },
        {
          type: "rename",
          fromProperties: ["missing1", "missing2"],
          toProperty: "target",
          onConflict: "skip",
        },
      );
      expect(out.changed).toBe(false);
    });
  });

  describe("wikilink wrapping", () => {
    it("wraps a plain string into [[...]]", () => {
      const out = applyActionPure(
        {},
        {
          type: "set",
          property: "moc",
          value: "Reise",
          mode: "overwrite",
          wrapWikilink: true,
        },
      );
      expect(out.after.moc).toBe("[[Reise]]");
    });

    it("keeps existing wikilink as-is", () => {
      const out = applyActionPure(
        {},
        {
          type: "set",
          property: "moc",
          value: "[[Reise]]",
          mode: "overwrite",
          wrapWikilink: true,
        },
      );
      expect(out.after.moc).toBe("[[Reise]]");
    });

    it("wraps list items", () => {
      const out = applyActionPure(
        { Vorname: "Anna", Nachname: "Doe" },
        {
          type: "copy",
          fromProperties: ["Vorname", "Nachname"],
          toProperty: "namesLinked",
          onConflict: "skip",
          wrapWikilink: true,
        },
      );
      expect(out.after.namesLinked).toEqual(["[[Anna]]", "[[Doe]]"]);
    });

    it("wraps template-resolved value", () => {
      const out = applyActionPure(
        { Thema: "Reise" },
        {
          type: "set",
          property: "moc",
          value: "{{Thema}}",
          mode: "overwrite",
          template: true,
          wrapWikilink: true,
        },
      );
      expect(out.after.moc).toBe("[[Reise]]");
    });
  });
});
