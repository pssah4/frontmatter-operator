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

  describe("rename / copy / move", () => {
    it("rename moves value and removes source", () => {
      const out = applyActionPure(
        { Beschreibung: "[[Note]]" },
        {
          type: "rename",
          fromProperty: "Beschreibung",
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
          fromProperty: "Beschreibung",
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
          fromProperty: "from",
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
          fromProperty: "from",
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
          fromProperty: "from",
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
          fromProperty: "from",
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
          fromProperty: "missing",
          toProperty: "target",
          onConflict: "skip",
        },
      );
      expect(out.changed).toBe(false);
    });
  });
});
