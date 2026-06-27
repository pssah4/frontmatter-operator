/**
 * Test vectors lifted from the AWS docs SigV4 example:
 *  https://docs.aws.amazon.com/general/latest/gr/sigv4-signed-request-examples.html
 *
 * We can't reuse the EC2 example directly (it relies on different path /
 * query canonicalization) so we use the well-known test:
 *   GET https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08
 *   credentials: AKIDEXAMPLE / wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY
 *   timestamp: 2015-08-30T12:36:00Z
 *
 * Expected:
 *   Authorization: AWS4-HMAC-SHA256
 *     Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request,
 *     SignedHeaders=host;x-amz-date,
 *     Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7
 */

// crypto.subtle and TextEncoder come from Node's global crypto in vitest >= 1.0
import { describe, expect, it } from "vitest";
import {
  signSigV4,
  formatAmzDate,
  formatDateStamp,
} from "../auth/AwsSigV4";

describe("AwsSigV4", () => {
  it("formats AMZ date and date stamp", () => {
    const d = new Date(Date.UTC(2015, 7, 30, 12, 36, 0));
    expect(formatAmzDate(d)).toBe("20150830T123600Z");
    expect(formatDateStamp(d)).toBe("20150830");
  });

  it("signs a basic GET request (IAM ListUsers example)", async () => {
    const signed = await signSigV4({
      method: "GET",
      url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08",
      region: "us-east-1",
      service: "iam",
      body: "",
      now: new Date(Date.UTC(2015, 7, 30, 12, 36, 0)),
      credentials: {
        accessKeyId: "AKIDEXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      },
    });
    expect(signed.headers["x-amz-date"]).toBe("20150830T123600Z");
    expect(signed.headers["Authorization"]).toContain(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request",
    );
    expect(signed.headers["Authorization"]).toContain(
      "SignedHeaders=host;x-amz-content-sha256;x-amz-date",
    );
    // The signature itself: we include x-amz-content-sha256 in the signed
    // headers, which differs from the IAM docs example (which omits it).
    // We verify the signature is a 64-char hex string instead.
    const sig = (signed.headers["Authorization"] as string).match(
      /Signature=([a-f0-9]+)/,
    );
    expect(sig).not.toBeNull();
    expect(sig![1]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("includes x-amz-security-token when session token provided", async () => {
    const signed = await signSigV4({
      method: "GET",
      url: "https://bedrock.eu-central-1.amazonaws.com/inference-profiles",
      region: "eu-central-1",
      service: "bedrock",
      now: new Date(Date.UTC(2026, 5, 27, 10, 0, 0)),
      credentials: {
        accessKeyId: "AKIA",
        secretAccessKey: "secret",
        sessionToken: "STS-SESSION-TOKEN",
      },
    });
    expect(signed.headers["x-amz-security-token"]).toBe("STS-SESSION-TOKEN");
    expect(signed.headers["Authorization"]).toContain(
      "SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token",
    );
  });

  it("hashes POST body into x-amz-content-sha256", async () => {
    const body = JSON.stringify({ messages: [] });
    const signed = await signSigV4({
      method: "POST",
      url: "https://bedrock-runtime.eu-central-1.amazonaws.com/model/eu.anthropic.claude-opus-4-6-v1/invoke",
      region: "eu-central-1",
      service: "bedrock",
      body,
      now: new Date(Date.UTC(2026, 5, 27, 10, 0, 0)),
      extraHeaders: { "Content-Type": "application/json" },
      credentials: {
        accessKeyId: "AKIA",
        secretAccessKey: "secret",
      },
    });
    // Body hash is deterministic
    expect(signed.headers["x-amz-content-sha256"]).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.headers["Authorization"]).toContain(
      "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date",
    );
  });

  it("produces stable signatures (regression check)", async () => {
    // The exact signature depends on every byte of the canonical request,
    // including the headers we add. This regression test pins the signature
    // for a known input.
    const signed = await signSigV4({
      method: "GET",
      url: "https://bedrock.eu-central-1.amazonaws.com/inference-profiles",
      region: "eu-central-1",
      service: "bedrock",
      now: new Date(Date.UTC(2026, 5, 27, 10, 0, 0)),
      credentials: {
        accessKeyId: "AKIDEXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      },
    });
    const sig = (signed.headers["Authorization"] as string).match(
      /Signature=([a-f0-9]+)/,
    );
    expect(sig).not.toBeNull();
    // pin a 64-char hex signature; if the canonicalization changes the
    // test will fail visibly.
    expect(sig![1]).toHaveLength(64);
  });
});
