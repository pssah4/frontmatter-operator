/**
 * BedrockDiscoveryList -- the discovery fetch must return the FULL set of
 * Converse-compatible models AWS reports for the region, not just the
 * curated MODEL_SUGGESTIONS families.
 *
 * Regression it guards: a hard `curated` gate reduced the ~45 models AWS
 * returns to ~5 (only the eu./us.-prefixed families that literally appear
 * in MODEL_SUGGESTIONS.bedrock), while Vault Operator shows the full list
 * for the same credentials + region. The curated set now only drives the
 * picker ORDER (via byBedrockPriority), never membership.
 */

import { describe, it, expect } from "vitest";
import { finalizeBedrockModels } from "../api/fetchModels";

type FM = { id: string; label: string; group?: string };
const fm = (id: string): FM => ({ id, label: id });

describe("finalizeBedrockModels", () => {
  it("keeps available non-curated models (no gate on MODEL_SUGGESTIONS)", () => {
    const merged = [
      fm("eu.anthropic.claude-opus-4-6-v1"), // curated
      fm("eu.mistral.mistral-large-2407-v1:0"), // Converse-safe, NOT curated
      fm("eu.meta.llama3-1-70b-instruct-v1:0"), // NOT curated
      fm("eu.anthropic.claude-3-5-haiku-20241022-v1:0"), // NOT in curated list
    ];
    const ids = finalizeBedrockModels(merged).map((m) => m.id);
    expect(ids).toContain("eu.mistral.mistral-large-2407-v1:0");
    expect(ids).toContain("eu.meta.llama3-1-70b-instruct-v1:0");
    expect(ids).toContain("eu.anthropic.claude-3-5-haiku-20241022-v1:0");
    expect(ids).toHaveLength(4);
  });

  it("deduplicates by id", () => {
    const merged = [
      fm("eu.anthropic.claude-opus-4-6-v1"),
      fm("eu.anthropic.claude-opus-4-6-v1"),
      fm("eu.amazon.nova-pro-v1:0"),
    ];
    expect(finalizeBedrockModels(merged)).toHaveLength(2);
  });

  it("orders curated inference-profile ids ahead of bare uncurated ones", () => {
    const merged = [
      fm("amazon.nova-2-lite-v1:0"), // bare, uncurated
      fm("eu.anthropic.claude-opus-4-6-v1"), // curated inference profile
    ];
    const sorted = finalizeBedrockModels(merged);
    expect(sorted[0].id).toBe("eu.anthropic.claude-opus-4-6-v1");
  });
});
