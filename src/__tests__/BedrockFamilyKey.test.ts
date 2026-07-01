/**
 * BedrockFamilyKey -- guards the family-match logic that prevents the
 * Refresh-clobber bug. Symptom: user picks "Claude Opus 4.6 (EU)"
 * from MODEL_SUGGESTIONS as default. After Refresh, AWS returns the
 * same model under a different id form (no -v1 suffix). A strict
 * equality check then can't match, so the auto-promote falls back to
 * sorted[0] -- the newest model AWS lists (e.g. Opus 4.8), which the
 * user's AWS account often has no access to. The first Generate call
 * then 400s with "You don't have access to model..."
 *
 * Family-key normalization fixes this by treating Opus-4-6,
 * Opus-4-6-v1, Opus-4-6-v1:0 as the SAME family.
 */

import { describe, it, expect } from "vitest";
import { bedrockFamilyKey } from "../api/fetchModels";
import { enhanceBedrockError } from "../api/providers/BedrockProvider";

describe("bedrockFamilyKey", () => {
  it("collapses -v1, -v1:0, -v2:0 to the same family", () => {
    const family = "eu.anthropic.claude-opus-4-6";
    expect(bedrockFamilyKey("eu.anthropic.claude-opus-4-6")).toBe(family);
    expect(bedrockFamilyKey("eu.anthropic.claude-opus-4-6-v1")).toBe(family);
    expect(bedrockFamilyKey("eu.anthropic.claude-opus-4-6-v1:0")).toBe(family);
    expect(bedrockFamilyKey("eu.anthropic.claude-opus-4-6-v2:0")).toBe(family);
  });

  it("preserves dated id segments", () => {
    expect(
      bedrockFamilyKey("anthropic.claude-3-5-sonnet-20241022-v2:0"),
    ).toBe("anthropic.claude-3-5-sonnet-20241022");
    expect(
      bedrockFamilyKey("eu.anthropic.claude-sonnet-4-5-20250929-v1:0"),
    ).toBe("eu.anthropic.claude-sonnet-4-5-20250929");
  });

  it("distinguishes Opus 4-6 from Opus 4-8", () => {
    expect(bedrockFamilyKey("eu.anthropic.claude-opus-4-6-v1")).not.toBe(
      bedrockFamilyKey("eu.anthropic.claude-opus-4-8"),
    );
  });

  it("handles Nova / Llama / Mistral version stripping", () => {
    expect(bedrockFamilyKey("eu.amazon.nova-pro-v1:0")).toBe(
      "eu.amazon.nova-pro",
    );
    expect(bedrockFamilyKey("meta.llama3-1-70b-instruct-v1:0")).toBe(
      "meta.llama3-1-70b-instruct",
    );
    expect(bedrockFamilyKey("mistral.mistral-large-2407-v1:0")).toBe(
      "mistral.mistral-large-2407",
    );
  });
});

describe("enhanceBedrockError", () => {
  function makeError(name: string, message: string): Error {
    const err = new Error(message);
    err.name = name;
    return err;
  }

  it("adds the model-access AWS console URL on AccessDeniedException", () => {
    const err = enhanceBedrockError(
      makeError("AccessDeniedException", "You don't have access to model X."),
      "eu.anthropic.claude-opus-4-8",
      "eu-central-1",
    );
    expect(err.message).toContain("https://eu-central-1.console.aws.amazon.com/bedrock/home");
    expect(err.message).toContain("eu.anthropic.claude-opus-4-8");
  });

  it("recognises the on-demand-throughput rejection and suggests profile id", () => {
    const err = enhanceBedrockError(
      makeError(
        "ValidationException",
        "Invocation of model ID amazon.nova-2-lite-v1:0 with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile that contains this model.",
      ),
      "amazon.nova-2-lite-v1:0",
      "eu-central-1",
    );
    expect(err.message).toContain("inference profile");
    expect(err.message).toContain("eu./us./ap./");
  });

  it("calls out model-not-available in region with the user's region", () => {
    const err = enhanceBedrockError(
      makeError(
        "ValidationException",
        "Provided model identifier is not available in this region.",
      ),
      "eu.anthropic.claude-opus-4-8",
      "eu-central-1",
    );
    expect(err.message).toContain("not available in eu-central-1");
    expect(err.message).toContain("Re-refresh in Discovery");
  });

  it("adds a model-access hint on a generic ValidationException", () => {
    const err = enhanceBedrockError(
      makeError("ValidationException", "Some other validation error."),
      "eu.anthropic.claude-opus-4-8",
      "eu-central-1",
    );
    expect(err.message).toContain("https://eu-central-1.console.aws.amazon.com");
  });

  it("I-2: scrubs AWS credential material from the surfaced message", () => {
    const err = enhanceBedrockError(
      makeError(
        "UnrecognizedClientException",
        "Bad signature Credential=AKIAIOSFODNN7EXAMPLE/20250101/eu-central-1/bedrock/aws4_request Signature=abcdef1234567890",
      ),
      "eu.anthropic.claude-sonnet-5",
      "eu-central-1",
    );
    expect(err.message).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(err.message).not.toContain("abcdef1234567890");
    expect(err.message).toContain("<redacted>");
  });

  it("falls back to the bare AWS error wording for unknown exceptions", () => {
    const err = enhanceBedrockError(
      makeError("InternalServerError", "Service unavailable"),
      "x",
      "us-east-1",
    );
    expect(err.message).toBe("Bedrock: InternalServerError: Service unavailable");
  });

  it("handles non-Error inputs without crashing", () => {
    const err = enhanceBedrockError("string-error", "x", "us-east-1");
    expect(err.message).toContain("string-error");
  });
});
