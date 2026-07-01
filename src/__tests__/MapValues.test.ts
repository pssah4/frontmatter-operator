import { describe, it, expect } from "vitest";
import { applyActionPure } from "../services/BulkActionService";
import type { MapValuesAction } from "../types";

function mapValues(
  property: string,
  valueMappings: MapValuesAction["valueMappings"],
  transforms: MapValuesAction["transforms"] = [],
): MapValuesAction {
  return { type: "map_values", property, transforms, valueMappings };
}

function m(source: string, target: string) {
  return { source, target, userEdited: true };
}

describe("applyActionPure: map_values (batch rename of values)", () => {
  it("rewrites a scalar value in place", () => {
    const out = applyActionPure(
      { type: "Interview" },
      mapValues("type", [m("Interview", "interview")]),
    );
    expect(out.changed).toBe(true);
    expect(out.after.type).toBe("interview");
  });

  it("rewrites list elements element-wise, leaving others intact", () => {
    const out = applyActionPure(
      { type: ["Interview", "source"] },
      mapValues("type", [m("Interview", "interview")]),
    );
    expect(out.changed).toBe(true);
    expect(out.after.type).toEqual(["interview", "source"]);
  });

  it("applies a bulk transform before the mapping table", () => {
    const out = applyActionPure(
      { type: "INTERVIEW" },
      mapValues("type", [], ["lowercase"]),
    );
    expect(out.changed).toBe(true);
    expect(out.after.type).toBe("interview");
  });

  it("preserves wikilink wrapping while rewriting the target", () => {
    const out = applyActionPure(
      { type: "[[Interview]]" },
      mapValues("type", [m("Interview", "interview")]),
    );
    expect(out.changed).toBe(true);
    expect(out.after.type).toBe("[[interview]]");
  });

  it("drops a list element whose target is empty", () => {
    const out = applyActionPure(
      { type: ["a", "Interview", "b"] },
      mapValues("type", [m("Interview", "")]),
    );
    expect(out.changed).toBe(true);
    expect(out.after.type).toEqual(["a", "b"]);
  });

  it("change detection: an unaffected value does not count as changed", () => {
    const out = applyActionPure(
      { type: "source" },
      mapValues("type", [m("Interview", "interview")]),
    );
    expect(out.changed).toBe(false);
    expect(out.after.type).toBe("source");
  });

  it("skips when the property is not present on the note", () => {
    const out = applyActionPure(
      { other: "x" },
      mapValues("type", [m("Interview", "interview")]),
    );
    expect(out.changed).toBe(false);
    expect(out.skipped).toBeDefined();
  });

  it("skips a reserved property key", () => {
    const out = applyActionPure(
      { type: "Interview" },
      mapValues("__proto__", [m("Interview", "interview")]),
    );
    expect(out.changed).toBe(false);
    expect(out.skipped).toBeDefined();
  });
});
