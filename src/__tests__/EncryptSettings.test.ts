/**
 * H-1 (AUDIT 2026-06-29): regression guard for secret-encryption
 * round-trip. Asserts that every long-lived credential is encrypted
 * before settings hit disk and decrypts back to the original value
 * on load. Uses a mock SafeStorageService so the test is hermetic.
 */

import { describe, it, expect } from "vitest";
import {
  assertNoPlaintextSecrets,
  decryptSettingsAfterLoad,
  encryptSettingsForSave,
} from "../auth/encryptSettings";
import type { SafeStorageService } from "../auth/SafeStorageService";
import type { FrontmatterEditorSettings } from "../types/settings";
import type { ProviderConfig } from "../types/llm";

class MockSafeStorage implements Pick<SafeStorageService, "encrypt" | "decrypt" | "isAvailable"> {
  isAvailable(): boolean {
    return true;
  }
  encrypt(plain: string | undefined): string | undefined {
    if (!plain) return plain;
    if (plain.startsWith("enc:v1:")) return plain;
    return `enc:v1:${Buffer.from(plain, "utf-8").toString("base64")}`;
  }
  decrypt(value: string | undefined): string | undefined {
    if (!value) return value;
    if (!value.startsWith("enc:v1:")) return value;
    return Buffer.from(value.slice("enc:v1:".length), "base64").toString("utf-8");
  }
}

function makeSettings(): FrontmatterEditorSettings {
  return {
    activeProviderId: null,
    defaultProviderId: null,
    githubCopilotAccessToken: "gho_supersecret",
    githubCopilotToken: "copilot_short_lived_bearer",
    githubCopilotTokenExpiresAt: 1782660000,
    chatgptOAuthAccessToken: "chatgpt_access_token",
    chatgptOAuthRefreshToken: "chatgpt_refresh_token_LONG_LIVED",
    chatgptOAuthIdToken: "chatgpt_id_jwt",
    chatgptOAuthAccountId: "acct_visible",
    chatgptOAuthEmail: "user@example.com",
    chatgptOAuthExpiresAt: 1782660000,
    kiloToken: "kilo_api_token_xyz",
    providers: [
      {
        id: "openai-1",
        type: "openai",
        displayName: "OpenAI",
        enabled: true,
        apiKey: "sk-secret-openai",
      },
      {
        id: "bedrock-1",
        type: "bedrock",
        displayName: "AWS Bedrock",
        enabled: true,
        awsApiKey: "bedrock_api_bearer",
        awsAccessKey: "AKIA_SECRET",
        awsSecretKey: "secret_access_key_VERY_SECRET",
        awsSessionToken: "sts_session_token",
        gatewayHeaderValue: "apim_subscription_key",
      },
    ] as ProviderConfig[],
    lastUsedModelByProvider: {},
    presets: [],
    customPrompts: [],
  } as unknown as FrontmatterEditorSettings;
}

describe("encryptSettingsForSave", () => {
  const safe = new MockSafeStorage() as unknown as SafeStorageService;

  it("encrypts every top-level secret field", () => {
    const out = encryptSettingsForSave(makeSettings(), safe);
    expect(out.githubCopilotAccessToken).toMatch(/^enc:v1:/);
    expect(out.githubCopilotToken).toMatch(/^enc:v1:/);
    expect(out.chatgptOAuthAccessToken).toMatch(/^enc:v1:/);
    expect(out.chatgptOAuthRefreshToken).toMatch(/^enc:v1:/);
    expect(out.chatgptOAuthIdToken).toMatch(/^enc:v1:/);
    expect(out.kiloToken).toMatch(/^enc:v1:/);
  });

  it("encrypts every per-provider secret field", () => {
    const out = encryptSettingsForSave(makeSettings(), safe);
    const openai = out.providers.find((p) => p.id === "openai-1")!;
    expect(openai.apiKey).toMatch(/^enc:v1:/);
    const bedrock = out.providers.find((p) => p.id === "bedrock-1")!;
    expect(bedrock.awsApiKey).toMatch(/^enc:v1:/);
    expect(bedrock.awsAccessKey).toMatch(/^enc:v1:/);
    expect(bedrock.awsSecretKey).toMatch(/^enc:v1:/);
    expect(bedrock.awsSessionToken).toMatch(/^enc:v1:/);
    expect(bedrock.gatewayHeaderValue).toMatch(/^enc:v1:/);
  });

  it("leaves non-secret fields unchanged", () => {
    const out = encryptSettingsForSave(makeSettings(), safe);
    expect(out.chatgptOAuthEmail).toBe("user@example.com");
    expect(out.chatgptOAuthAccountId).toBe("acct_visible");
    expect(out.chatgptOAuthExpiresAt).toBe(1782660000);
    expect(out.providers[0].displayName).toBe("OpenAI");
    expect(out.providers[0].enabled).toBe(true);
  });

  it("never mutates the input settings", () => {
    const settings = makeSettings();
    encryptSettingsForSave(settings, safe);
    expect(settings.githubCopilotAccessToken).toBe("gho_supersecret");
    expect(settings.providers[1].awsSecretKey).toBe("secret_access_key_VERY_SECRET");
  });

  it("encrypt + decrypt round-trip restores every field exactly", () => {
    const original = makeSettings();
    const encrypted = encryptSettingsForSave(original, safe);
    // Simulate disk -> load: deep-clone the encrypted form so we
    // don't accidentally compare against the (mutated) clone.
    const fromDisk = JSON.parse(JSON.stringify(encrypted)) as FrontmatterEditorSettings;
    decryptSettingsAfterLoad(fromDisk, safe);
    expect(fromDisk.githubCopilotAccessToken).toBe("gho_supersecret");
    expect(fromDisk.chatgptOAuthRefreshToken).toBe("chatgpt_refresh_token_LONG_LIVED");
    expect(fromDisk.kiloToken).toBe("kilo_api_token_xyz");
    expect(fromDisk.providers[0].apiKey).toBe("sk-secret-openai");
    expect(fromDisk.providers[1].awsSecretKey).toBe("secret_access_key_VERY_SECRET");
  });

  it("idempotent: encrypting an already-encrypted value is a no-op", () => {
    const once = encryptSettingsForSave(makeSettings(), safe);
    const twice = encryptSettingsForSave(once, safe);
    expect(twice.githubCopilotAccessToken).toBe(once.githubCopilotAccessToken);
    expect(twice.providers[1].awsSecretKey).toBe(once.providers[1].awsSecretKey);
  });
});

describe("assertNoPlaintextSecrets", () => {
  const safe = new MockSafeStorage() as unknown as SafeStorageService;

  it("reports zero offenders after encrypt", () => {
    const encrypted = encryptSettingsForSave(makeSettings(), safe);
    expect(assertNoPlaintextSecrets(encrypted)).toEqual([]);
  });

  it("reports every plaintext top-level + per-provider secret field", () => {
    const offenders = assertNoPlaintextSecrets(makeSettings());
    // Top-level secrets
    expect(offenders).toContain("githubCopilotAccessToken");
    expect(offenders).toContain("githubCopilotToken");
    expect(offenders).toContain("chatgptOAuthAccessToken");
    expect(offenders).toContain("chatgptOAuthRefreshToken");
    expect(offenders).toContain("chatgptOAuthIdToken");
    expect(offenders).toContain("kiloToken");
    // Provider secrets (paths include provider id)
    expect(offenders.some((o) => o.startsWith("providers[openai-1]."))).toBe(true);
    expect(offenders.some((o) => o.startsWith("providers[bedrock-1]."))).toBe(true);
  });

  it("returns empty for a settings object with no secrets set", () => {
    expect(
      assertNoPlaintextSecrets({
        providers: [],
        lastUsedModelByProvider: {},
        presets: [],
        customPrompts: [],
      } as unknown as FrontmatterEditorSettings),
    ).toEqual([]);
  });
});

describe("decryptSettingsAfterLoad -- legacy plaintext passthrough", () => {
  const safe = new MockSafeStorage() as unknown as SafeStorageService;

  it("leaves plaintext values unchanged (legacy data.json compatibility)", () => {
    const legacy = makeSettings(); // already plaintext
    decryptSettingsAfterLoad(legacy, safe);
    expect(legacy.githubCopilotAccessToken).toBe("gho_supersecret");
    expect(legacy.providers[1].awsSecretKey).toBe("secret_access_key_VERY_SECRET");
  });
});
