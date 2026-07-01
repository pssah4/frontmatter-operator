/**
 * ModelTemperatureSupport -- guards which models must have the `temperature`
 * sampling parameter OMITTED from the request.
 *
 * Symptom: generating with the global Claude Sonnet 5 cross-region profile on
 * Bedrock (eu-central-1) failed with
 *   ValidationException: `temperature` is deprecated for this model
 * because FO always sent temperature (default 0). Newer Anthropic models
 * (Claude 5 generation, Opus 4.7+, Fable/Mythos) and OpenAI GPT-5 dropped the
 * sampling parameters and 400 on any value. The id must be matched across all
 * prefix forms: direct (claude-sonnet-5), Bedrock cross-region
 * (eu./us./global.anthropic.claude-sonnet-5-...-v1:0) and OpenRouter
 * (anthropic/claude-sonnet-5).
 */

import { describe, it, expect } from "vitest";
import { modelSupportsTemperature } from "../types/llm";

describe("modelSupportsTemperature", () => {
  const OMIT_TEMPERATURE = [
    // Claude 5 generation -- the reported failure
    "claude-sonnet-5",
    "global.anthropic.claude-sonnet-5-20250929-v1:0",
    "eu.anthropic.claude-sonnet-5-20250929-v1:0",
    "us.anthropic.claude-opus-5-v1:0",
    "anthropic/claude-sonnet-5",
    "eu.anthropic.claude-haiku-5-v1:0",
    // Opus 4.7+ snapshots
    "claude-opus-4-7",
    "eu.anthropic.claude-opus-4-8-v1",
    "claude-opus-4-10",
    // Fable / Mythos
    "claude-fable-5",
    "claude-mythos-5",
    // OpenAI GPT-5 family
    "gpt-5",
    "gpt-5.4",
    "gpt-5-mini",
  ];

  const KEEP_TEMPERATURE = [
    "claude-sonnet-4-5-20250929",
    "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "claude-opus-4-6",
    "eu.anthropic.claude-opus-4-6-v1",
    "claude-haiku-4-5-20251001",
    "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "eu.amazon.nova-pro-v1:0",
    "meta.llama3-1-70b-instruct-v1:0",
    "gpt-4o",
    "gpt-4.1",
  ];

  it("omits temperature for the Claude 5 generation / Opus 4.7+ / GPT-5", () => {
    for (const id of OMIT_TEMPERATURE) {
      expect(
        modelSupportsTemperature(id),
        `Expected '${id}' to have temperature omitted`,
      ).toBe(false);
    }
  });

  it("keeps temperature for models that still accept it", () => {
    for (const id of KEEP_TEMPERATURE) {
      expect(
        modelSupportsTemperature(id),
        `Expected '${id}' to keep temperature`,
      ).toBe(true);
    }
  });
});
