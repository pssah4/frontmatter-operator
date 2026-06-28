/**
 * BedrockConverseFilter -- guard the family denylist that gates which
 * Bedrock model ids reach the picker. Symptom we're guarding against:
 * ConverseCommand returns "ValidationException: This action doesn't
 * support the model that you provided. Try again with a supported text
 * or chat model." That happens when the picker surfaces an embedding /
 * image-gen / video-gen / rerank / speech / guardrail model. The
 * server-side TEXT-modality gate already cuts most of them; this filter
 * is the belt-and-suspenders.
 */

import { describe, it, expect } from "vitest";
import {
  BEDROCK_NON_CONVERSE_DENYLIST,
  isConverseCompatibleId,
} from "../api/fetchModels";

describe("Bedrock Converse compatibility filter", () => {
  const NON_CONVERSE = [
    "cohere.embed-english-v3",
    "cohere.embed-multilingual-v3",
    "amazon.titan-embed-text-v2:0",
    "amazon.titan-embed-image-v1",
    "amazon.titan-image-generator-v2:0",
    "amazon.nova-canvas-v1:0",
    "us.amazon.nova-canvas-v1:0",
    "amazon.nova-reel-v1:1",
    "eu.amazon.nova-reel-v1:0",
    "amazon.nova-sonic-v1:0",
    "amazon.rerank-v1:0",
    "cohere.rerank-english-v3:0",
    "stability.sd3-large-v1:0",
    "stability.stable-image-ultra-v1:0",
    "stable-diffusion-xl-v1",
    "ai21.jamba-instruct-v1:0",
    "ai21.j2-mid-v1",
    "ai21.j2-ultra-v1",
    "ai21.contextual-answers-v1",
    "ai21.summarize-v1",
    "amazon.guardrail-v1",
    "meta.llama2-70b-chat-v1",
    "cohere.command-text-v14",
    "cohere.command-light-text-v14",
    "amazon.transcribe-v1",
  ];

  const CONVERSE_OK = [
    "anthropic.claude-opus-4-6-v1:0",
    "eu.anthropic.claude-opus-4-6-v1",
    "us.anthropic.claude-opus-4-6-v1",
    "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "eu.anthropic.claude-3-7-sonnet-20250219-v1:0",
    "eu.anthropic.claude-3-5-sonnet-20241022-v2:0",
    "anthropic.claude-3-haiku-20240307-v1:0",
    "eu.amazon.nova-pro-v1:0",
    "eu.amazon.nova-lite-v1:0",
    "us.amazon.nova-pro-v1:0",
    "us.amazon.nova-lite-v1:0",
    "us.amazon.nova-micro-v1:0",
    "meta.llama3-1-70b-instruct-v1:0",
    "meta.llama3-2-90b-instruct-v1:0",
    "mistral.mistral-large-2407-v1:0",
    "mistral.mistral-7b-instruct-v0:2",
    "cohere.command-r-v1:0",
    "cohere.command-r-plus-v1:0",
    "ai21.jamba-1-5-large-v1:0",
    "ai21.jamba-1-5-mini-v1:0",
  ];

  it("rejects every non-Converse family", () => {
    for (const id of NON_CONVERSE) {
      expect(
        isConverseCompatibleId(id),
        `Expected '${id}' to be rejected by the denylist`,
      ).toBe(false);
    }
  });

  it("admits every Converse-compatible chat model", () => {
    for (const id of CONVERSE_OK) {
      expect(
        isConverseCompatibleId(id),
        `Expected '${id}' to pass the denylist`,
      ).toBe(true);
    }
  });

  it("denylist has at least one pattern per excluded family", () => {
    const families = [
      "embed",
      "image",
      "canvas",
      "reel",
      "sonic",
      "rerank",
      "stability",
      "stable-diffusion",
      "jamba-instruct",
      "j2-",
      "contextual-answers",
      "summarize",
      "guardrail",
      "llama2",
      "command-",
      "transcribe",
    ];
    for (const family of families) {
      const hit = BEDROCK_NON_CONVERSE_DENYLIST.some(({ pattern }) =>
        pattern.source.toLowerCase().includes(family.toLowerCase()),
      );
      expect(hit, `Denylist missing family pattern for '${family}'`).toBe(true);
    }
  });
});
