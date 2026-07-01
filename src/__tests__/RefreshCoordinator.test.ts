import { describe, it, expect, vi } from "vitest";
import { RefreshCoordinator } from "../ui/RefreshCoordinator";

/**
 * Cover for the live-view refresh policy: refresh on every change EXCEPT
 * during a batch operation, which must run fully and then refresh once.
 */
describe("RefreshCoordinator", () => {
  it("flushes immediately for a change outside a batch", () => {
    const flush = vi.fn();
    const c = new RefreshCoordinator(flush);
    c.request();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("suspends during a batch and flushes once at the end", () => {
    const flush = vi.fn();
    const c = new RefreshCoordinator(flush);
    c.beginBatch();
    c.request();
    c.request();
    c.request();
    expect(flush).not.toHaveBeenCalled();
    c.endBatch();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("does not flush at batch end when nothing changed", () => {
    const flush = vi.fn();
    const c = new RefreshCoordinator(flush);
    c.beginBatch();
    c.endBatch();
    expect(flush).not.toHaveBeenCalled();
  });

  it("only flushes when the outermost nested batch ends", () => {
    const flush = vi.fn();
    const c = new RefreshCoordinator(flush);
    c.beginBatch();
    c.beginBatch();
    c.request();
    c.endBatch();
    expect(flush).not.toHaveBeenCalled(); // still one batch deep
    c.endBatch();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("reports suspension state", () => {
    const c = new RefreshCoordinator(() => {});
    expect(c.isSuspended).toBe(false);
    c.beginBatch();
    expect(c.isSuspended).toBe(true);
    c.endBatch();
    expect(c.isSuspended).toBe(false);
  });

  it("ignores an unbalanced endBatch (no negative depth, no flush)", () => {
    const flush = vi.fn();
    const c = new RefreshCoordinator(flush);
    c.endBatch();
    expect(flush).not.toHaveBeenCalled();
    expect(c.isSuspended).toBe(false);
    // a following request still works normally
    c.request();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("each change outside a batch flushes (caller debounces)", () => {
    const flush = vi.fn();
    const c = new RefreshCoordinator(flush);
    c.request();
    c.request();
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("resets pending so a later idle batch does not flush spuriously", () => {
    const flush = vi.fn();
    const c = new RefreshCoordinator(flush);
    c.beginBatch();
    c.request();
    c.endBatch();
    expect(flush).toHaveBeenCalledTimes(1);
    // second batch with no changes must not flush again
    c.beginBatch();
    c.endBatch();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
