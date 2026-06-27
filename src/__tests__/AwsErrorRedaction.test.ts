import { describe, expect, it } from "vitest";
import { scrubAwsError } from "../api/fetchModels";

describe("scrubAwsError", () => {
  it("redacts AKIA / ASIA access key ids", () => {
    expect(
      scrubAwsError(
        "Authorization=AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20260627/us-east-1/iam/aws4_request",
      ),
    ).toContain("<redacted>");
    expect(
      scrubAwsError("token: ASIAIOSFODNN7EXAMPLE"),
    ).not.toContain("ASIAIOSFODNN");
  });

  it("redacts Credential= portions of the Authorization header", () => {
    const s = scrubAwsError(
      "Authorization=AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20260627/eu-central-1/bedrock/aws4_request, SignedHeaders=host;x-amz-date, Signature=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    );
    expect(s).not.toContain("AKIDEXAMPLE");
    expect(s).not.toContain("abcdef0123456789");
    expect(s).toContain("<redacted>");
  });

  it("redacts session token leaks", () => {
    expect(
      scrubAwsError("x-amz-security-token: STS-SESSION-XYZ\nother text"),
    ).not.toContain("STS-SESSION-XYZ");
  });

  it("surfaces only __type + message from JSON envelopes", () => {
    const body = JSON.stringify({
      __type: "SignatureDoesNotMatch",
      message: "Computed signature does not match",
    });
    expect(scrubAwsError(body)).toBe(
      "SignatureDoesNotMatch: Computed signature does not match",
    );
  });

  it("surfaces only Code + Message from XML envelopes", () => {
    const body = `<ErrorResponse><Error><Code>InvalidSignature</Code><Message>The request signature we calculated does not match</Message></Error></ErrorResponse>`;
    expect(scrubAwsError(body)).toBe(
      "InvalidSignature: The request signature we calculated does not match",
    );
  });

  it("truncates long bodies without recognizable envelopes", () => {
    const huge = "x".repeat(1000);
    expect(scrubAwsError(huge).length).toBeLessThanOrEqual(300);
  });

  it("returns empty string for empty input", () => {
    expect(scrubAwsError("")).toBe("");
  });
});
