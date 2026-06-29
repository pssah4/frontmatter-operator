/**
 * L-4 SAST (AUDIT 2026-06-29): regression guard for gateway header
 * RFC 7230 validation + forbidden-name blocklist.
 */

import { describe, it, expect } from "vitest";
import {
  assertValidHeader,
  validateHeaderName,
  validateHeaderValue,
} from "../api/headerValidation";

describe("validateHeaderName", () => {
  it("accepts standard tokens", () => {
    expect(validateHeaderName("Ocp-Apim-Subscription-Key")).toBeNull();
    expect(validateHeaderName("X-Custom-Header")).toBeNull();
    expect(validateHeaderName("anthropic-version")).toBeNull();
  });

  it("rejects empty / whitespace-only", () => {
    expect(validateHeaderName("")).toContain("cannot be empty");
    expect(validateHeaderName("   ")).toContain("cannot be empty");
  });

  it("rejects CR / LF / colon", () => {
    expect(validateHeaderName("X-Header\r\nInjected")).not.toBeNull();
    expect(validateHeaderName("X-Name: bad")).not.toBeNull();
  });

  it("rejects reserved header names case-insensitively", () => {
    expect(validateHeaderName("Host")).toContain("reserved");
    expect(validateHeaderName("HOST")).toContain("reserved");
    expect(validateHeaderName("Authorization")).toContain("reserved");
    expect(validateHeaderName("Content-Length")).toContain("reserved");
    expect(validateHeaderName("transfer-encoding")).toContain("reserved");
  });
});

describe("validateHeaderValue", () => {
  it("accepts printable ASCII + tab", () => {
    expect(validateHeaderValue("real-bearer-token-12345")).toBeNull();
    expect(validateHeaderValue("with\ttab and spaces")).toBeNull();
  });

  it("rejects empty", () => {
    expect(validateHeaderValue("")).toContain("cannot be empty");
  });

  it("rejects CR / LF (header smuggling)", () => {
    expect(validateHeaderValue("ok\r\nInjected: yes")).toContain(
      "control character",
    );
    expect(validateHeaderValue("ok\nbad")).toContain("control character");
  });

  it("rejects NUL byte", () => {
    expect(validateHeaderValue("ok\x00bad")).toContain("control character");
  });

  it("rejects DEL (0x7F)", () => {
    expect(validateHeaderValue("ok\x7fbad")).toContain("control character");
  });
});

describe("assertValidHeader", () => {
  it("succeeds for valid pair", () => {
    expect(() =>
      assertValidHeader("Ocp-Apim-Subscription-Key", "abcd1234"),
    ).not.toThrow();
  });

  it("throws on invalid name", () => {
    expect(() => assertValidHeader("Host", "anything")).toThrow(/reserved/);
  });

  it("throws on invalid value", () => {
    expect(() =>
      assertValidHeader("X-Header", "smuggled\r\nInjected: 1"),
    ).toThrow(/control character/);
  });
});
