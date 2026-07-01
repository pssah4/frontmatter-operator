import { describe, it, expect } from "vitest";
import { assertSafeProviderUrl } from "../api/providerUrlGuard";
import { ProviderError } from "../types/llm";

describe("assertSafeProviderUrl", () => {
  it("allows https for cloud providers", () => {
    expect(() =>
      assertSafeProviderUrl("https://api.openai.com/v1/chat/completions", "openai"),
    ).not.toThrow();
    expect(() =>
      assertSafeProviderUrl("https://api.anthropic.com/v1/messages", "anthropic"),
    ).not.toThrow();
  });

  it("rejects http for cloud providers (cleartext credential leak)", () => {
    expect(() =>
      assertSafeProviderUrl("http://api.openai.com/v1/chat/completions", "openai"),
    ).toThrow(ProviderError);
  });

  it("allows http to loopback for local providers", () => {
    expect(() =>
      assertSafeProviderUrl("http://localhost:11434/api/tags", "ollama"),
    ).not.toThrow();
    expect(() =>
      assertSafeProviderUrl("http://127.0.0.1:1234/v1/chat/completions", "lmstudio"),
    ).not.toThrow();
    expect(() =>
      assertSafeProviderUrl("http://127.0.0.1:8080/chat/completions", "custom"),
    ).not.toThrow();
  });

  it("L-1: rejects http to 0.0.0.0 even for local providers", () => {
    expect(() =>
      assertSafeProviderUrl("http://0.0.0.0:11434/api/tags", "ollama"),
    ).toThrow(ProviderError);
  });

  it("rejects http to a remote host even for local provider types", () => {
    expect(() =>
      assertSafeProviderUrl("http://evil.example.com/v1/chat/completions", "custom"),
    ).toThrow(ProviderError);
  });

  it("rejects http to loopback for cloud providers", () => {
    expect(() =>
      assertSafeProviderUrl("http://127.0.0.1:11434/v1/chat/completions", "openai"),
    ).toThrow(ProviderError);
  });

  it("blocks cloud-metadata endpoints over any scheme/provider", () => {
    expect(() =>
      assertSafeProviderUrl("http://169.254.169.254/latest/meta-data/", "ollama"),
    ).toThrow(ProviderError);
    expect(() =>
      assertSafeProviderUrl("https://169.254.169.254/latest/meta-data/", "openai"),
    ).toThrow(ProviderError);
    expect(() =>
      assertSafeProviderUrl("https://metadata.google.internal/computeMetadata/v1/", "custom"),
    ).toThrow(ProviderError);
  });

  it("L-1: blocks metadata host with a trailing dot", () => {
    expect(() =>
      assertSafeProviderUrl(
        "https://metadata.google.internal./computeMetadata/v1/",
        "custom",
      ),
    ).toThrow(ProviderError);
  });

  it("L-1: blocks the full IPv4 link-local range, not just the IMDS IP", () => {
    expect(() =>
      assertSafeProviderUrl("https://169.254.0.1/latest/", "openai"),
    ).toThrow(ProviderError);
    // ECS/EKS task-metadata sibling in the same /16
    expect(() =>
      assertSafeProviderUrl("https://169.254.170.2/latest/meta-data/", "custom"),
    ).toThrow(ProviderError);
  });

  it("L-1: blocks IPv6 link-local (fe80::/10)", () => {
    expect(() =>
      assertSafeProviderUrl("https://[fe80::1]/x", "openai"),
    ).toThrow(ProviderError);
  });

  it("L-1: still allows a normal host carrying a trailing dot (FQDN root)", () => {
    expect(() =>
      assertSafeProviderUrl(
        "https://api.openai.com./v1/chat/completions",
        "openai",
      ),
    ).not.toThrow();
  });

  it("rejects non-http(s) schemes", () => {
    expect(() =>
      assertSafeProviderUrl("file:///etc/passwd", "custom"),
    ).toThrow(ProviderError);
    expect(() =>
      assertSafeProviderUrl("ftp://example.com/models", "openai"),
    ).toThrow(ProviderError);
  });

  it("rejects a malformed URL", () => {
    expect(() => assertSafeProviderUrl("not a url", "openai")).toThrow(
      ProviderError,
    );
  });
});
