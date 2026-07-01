import { describe, it, expect } from "vitest";
import { openExternal } from "../auth/openExternal";

// L-4 (AUDIT v0.2.0): openExternal must refuse non-http(s) schemes before
// handing the URL to the OS handler. The rejection branches return false
// without touching `window`/electron, so they are testable in the node env.

describe("openExternal scheme guard", () => {
  it("refuses file:// URLs", () => {
    expect(openExternal("file:///etc/passwd")).toBe(false);
  });

  it("refuses custom/non-http(s) schemes", () => {
    expect(openExternal("smb://host/share")).toBe(false);
    expect(openExternal("javascript:alert(1)")).toBe(false);
  });

  it("refuses a malformed URL", () => {
    expect(openExternal("not a url")).toBe(false);
  });
});
