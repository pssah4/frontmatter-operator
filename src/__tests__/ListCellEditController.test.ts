import { describe, it, expect } from "vitest";
import { ListCellEditController } from "../ui/components/ListCellEditController";

/**
 * Regression cover for the "manually added list entry is written twice" bug.
 *
 * Root cause in the DOM layer: `bindListEditor` recreated the focused input
 * on every chip add. Removing the focused input from the DOM fires a `blur`
 * on the stale element, whose handler re-read the still-present value and
 * pushed it a second time (plus committed prematurely).
 *
 * The controller is the single source of truth for both the committed items
 * AND the in-progress buffer, so a stray flush after an add finds the buffer
 * already cleared and cannot re-add. These tests pin that invariant down
 * independently of the DOM.
 */
describe("ListCellEditController", () => {
  it("adding a value then flushing does NOT duplicate it (the bug)", () => {
    const c = new ListCellEditController([]);
    c.setBuffer("note");
    expect(c.addBuffered()).toBe(true);
    expect(c.itemsView).toEqual(["note"]);

    // Simulate a stray blur/flush right after the add (what the old DOM did).
    const res = c.commitIfChanged();
    expect(res).toEqual({ value: ["note"] }); // NOT ["note", "note"]
  });

  it("addBuffered clears the buffer so a later add cannot repeat it", () => {
    const c = new ListCellEditController([]);
    c.setBuffer("foo");
    c.addBuffered();
    // No new setBuffer -> buffer is empty now.
    expect(c.addBuffered()).toBe(false);
    expect(c.itemsView).toEqual(["foo"]);
  });

  it("collects multiple distinct adds in order", () => {
    const c = new ListCellEditController([]);
    c.setBuffer("a");
    c.addBuffered();
    c.setBuffer("b");
    c.addBuffered();
    expect(c.commit()).toEqual({ value: ["a", "b"] });
  });

  it("commit on an empty list yields undefined (delete the property)", () => {
    const c = new ListCellEditController([]);
    expect(c.commit()).toEqual({ value: undefined });
  });

  it("commit is idempotent -- a second commit/flush is a no-op", () => {
    const c = new ListCellEditController([]);
    c.setBuffer("x");
    expect(c.commit()).toEqual({ value: ["x"] });
    expect(c.commit()).toBeNull();
    expect(c.commitIfChanged()).toBeNull();
  });

  it("cancel stops any later flush from committing", () => {
    const c = new ListCellEditController(["keep"]);
    c.setBuffer("dropme");
    c.cancel();
    expect(c.commit()).toBeNull();
    expect(c.commitIfChanged()).toBeNull();
  });

  it("commitIfChanged signals 'unchanged' when nothing was edited", () => {
    const c = new ListCellEditController(["x"]);
    expect(c.commitIfChanged()).toBe("unchanged");
  });

  it("commitIfChanged commits a half-typed buffer", () => {
    const c = new ListCellEditController(["x"]);
    c.setBuffer("y");
    expect(c.commitIfChanged()).toEqual({ value: ["x", "y"] });
  });

  it("removeLast pops only when the buffer is empty", () => {
    const c = new ListCellEditController(["a", "b"]);
    c.setBuffer("typing");
    expect(c.removeLast()).toBe(false); // buffer non-empty -> protect chips
    c.setBuffer("");
    expect(c.removeLast()).toBe(true);
    expect(c.itemsView).toEqual(["a"]);
  });

  it("removeAt removes a specific chip", () => {
    const c = new ListCellEditController(["a", "b", "c"]);
    c.removeAt(1);
    expect(c.itemsView).toEqual(["a", "c"]);
  });

  it("whitespace-only buffer adds nothing but is cleared", () => {
    const c = new ListCellEditController([]);
    c.setBuffer("   ");
    expect(c.addBuffered()).toBe(false);
    expect(c.itemsView).toEqual([]);
  });

  it("does not alias the caller's initial array", () => {
    const initial = ["a"];
    const c = new ListCellEditController(initial);
    c.setBuffer("b");
    c.addBuffered();
    expect(initial).toEqual(["a"]); // controller copied, no mutation
    expect(c.itemsView).toEqual(["a", "b"]);
  });
});
