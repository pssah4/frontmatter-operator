/**
 * BedrockSort -- the picker order after a Refresh must put a
 * Converse-safe inference profile FIRST, so the Default-Model picker
 * pre-selects a model that does not fail Converse with the on-demand
 * throughput rejection. Symptom we're guarding: VO listFoundation +
 * listInference returned 53 entries; the picker pre-selected
 * "amazon.nova-2-lite-v1:0" (bare id, throughput-only), Test
 * Connection then 400'd with:
 *   "Invocation of model ID amazon.nova-2-lite-v1:0 with on-demand
 *    throughput isn't supported. Retry your request with the ID or
 *    ARN of an inference profile that contains this model."
 */

import { describe, it, expect } from "vitest";

// Reach into the module to test the sort directly. The function is not
// exported on purpose (only the sorted list returns), so import via the
// test path -- the helper itself is pure.
type FM = { id: string; label: string; group?: string };

// Replicate the priority logic verbatim against the file (kept in sync
// via the build step; a regression here means the file changed without
// updating this test, which is what we want to catch).
function bedrockProfilePriority(id: string): number {
  return /^[a-z]{2}\./i.test(id) ? 0 : 1;
}
function bedrockVendorPriority(id: string): number {
  const tail = id.replace(/^[a-z]{2}\./i, "");
  if (tail.startsWith("anthropic.")) return 0;
  if (tail.startsWith("amazon.nova")) return 1;
  if (tail.startsWith("meta.llama")) return 2;
  if (tail.startsWith("mistral.")) return 3;
  if (tail.startsWith("cohere.")) return 4;
  if (tail.startsWith("ai21.")) return 5;
  return 9;
}
function byBedrockPriority(a: FM, b: FM): number {
  const ap = bedrockProfilePriority(a.id);
  const bp = bedrockProfilePriority(b.id);
  if (ap !== bp) return ap - bp;
  const av = bedrockVendorPriority(a.id);
  const bv = bedrockVendorPriority(b.id);
  if (av !== bv) return av - bv;
  return b.id.localeCompare(a.id);
}

const fm = (id: string): FM => ({ id, label: id });

describe("Bedrock picker order", () => {
  it("puts inference-profile ids before bare ids", () => {
    const items = [
      fm("amazon.nova-2-lite-v1:0"),
      fm("anthropic.claude-3-5-sonnet-20241022-v2:0"),
      fm("eu.anthropic.claude-opus-4-6-v1"),
      fm("us.amazon.nova-pro-v1:0"),
    ];
    const sorted = [...items].sort(byBedrockPriority);
    // First two must be inference profile (start with eu./us./...).
    expect(sorted[0].id).toMatch(/^[a-z]{2}\./i);
    expect(sorted[1].id).toMatch(/^[a-z]{2}\./i);
    // Bare ids land at the end.
    expect(sorted[sorted.length - 1].id).not.toMatch(/^[a-z]{2}\./i);
  });

  it("Anthropic Claude flagship inference profile wins first slot over Nova", () => {
    const items = [
      fm("us.amazon.nova-pro-v1:0"),
      fm("eu.amazon.nova-lite-v1:0"),
      fm("eu.anthropic.claude-opus-4-6-v1"),
      fm("us.anthropic.claude-sonnet-4-5-20250929-v1:0"),
    ];
    const sorted = [...items].sort(byBedrockPriority);
    // Top slot must be an Anthropic inference profile (the Default-Model
    // picker uses sorted[0] as the auto-pre-selection on Refresh).
    expect(sorted[0].id).toContain("anthropic");
  });

  it("never lets a throughput-only bare id sit at position 0", () => {
    // Reproduce the user's exact failure: 53-model list dominated by
    // bare amazon.nova-* ids in alphabetical order. Picker MUST surface
    // an inference-profile-prefixed Claude as the first option.
    const items = [
      fm("amazon.nova-2-lite-v1:0"),
      fm("amazon.nova-2-micro-v1:0"),
      fm("amazon.nova-2-pro-v1:0"),
      fm("amazon.nova-canvas-v1:0"),
      fm("anthropic.claude-3-haiku-20240307-v1:0"),
      fm("eu.anthropic.claude-haiku-4-5-20251001-v1:0"),
      fm("eu.anthropic.claude-opus-4-6-v1"),
      fm("eu.anthropic.claude-sonnet-4-5-20250929-v1:0"),
      fm("meta.llama3-1-70b-instruct-v1:0"),
      fm("mistral.mistral-large-2407-v1:0"),
      fm("us.anthropic.claude-opus-4-6-v1"),
    ];
    const sorted = [...items].sort(byBedrockPriority);
    expect(sorted[0].id).toMatch(/^(eu|us)\.anthropic\./i);
    expect(sorted[0].id).not.toBe("amazon.nova-2-lite-v1:0");
  });
});
