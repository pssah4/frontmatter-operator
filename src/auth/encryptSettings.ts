/**
 * H-1 (AUDIT 2026-06-29): every long-lived secret the plugin
 * persists is encrypted via Electron's safeStorage before the
 * settings hit disk, and decrypted on load. Without this, the
 * SafeStorageService class was dead code and data.json contained
 * raw GitHub OAuth tokens, ChatGPT refresh tokens, AWS access+secret
 * keys, etc.
 *
 * Strategy:
 *   - Both functions accept the WHOLE settings object and walk a
 *     known SENSITIVE_KEYS schema (top-level + per-provider).
 *   - Encryption is a no-op when safeStorage is unavailable
 *     (Obsidian-mobile / Linux without keychain); SafeStorageService
 *     already surfaces a Notice for that case.
 *   - The "enc:v1:" envelope is detected on both sides so a value
 *     that's already encrypted is left alone, and a value that's
 *     never been encrypted (legacy / unmodified after migration)
 *     decrypts to itself.
 *   - Migration: the first save after this lands will rewrite the
 *     plaintext values with their encrypted counterparts. No
 *     explicit migration step needed.
 */

import type { ProviderConfig } from "../types/llm";
import type { FrontmatterEditorSettings } from "../types/settings";
import type { SafeStorageService } from "./SafeStorageService";

/**
 * Top-level secret keys on FrontmatterEditorSettings. Anything that
 * grants API access or carries OAuth state.
 */
const TOP_LEVEL_SECRETS: ReadonlyArray<keyof FrontmatterEditorSettings> = [
  "githubCopilotAccessToken",
  "githubCopilotToken",
  "githubCopilotDeviceCode",
  "chatgptOAuthAccessToken",
  "chatgptOAuthRefreshToken",
  "chatgptOAuthIdToken",
  "kiloToken",
] as const;

/**
 * Per-provider secret keys. The provider config is a generic shape
 * with many optional fields; we encrypt the credential-carrying ones
 * only.
 */
const PROVIDER_SECRETS: ReadonlyArray<keyof ProviderConfig> = [
  "apiKey",
  "awsApiKey",
  "awsAccessKey",
  "awsSecretKey",
  "awsSessionToken",
  "gatewayHeaderValue",
] as const;

/**
 * Encrypt every secret field in place on a CLONE of the settings.
 * Returns the clone -- never mutates the live object so a failed
 * write doesn't poison in-memory state. Idempotent: a value that
 * already starts with "enc:v1:" is returned untouched.
 */
export function encryptSettingsForSave(
  settings: FrontmatterEditorSettings,
  safeStorage: SafeStorageService,
): FrontmatterEditorSettings {
  // Deep clone so the on-disk shape never affects the in-memory
  // copy. The settings object is small (a few KB) so the clone cost
  // is negligible.
  const clone = JSON.parse(JSON.stringify(settings)) as FrontmatterEditorSettings;

  for (const key of TOP_LEVEL_SECRETS) {
    const v = clone[key];
    if (typeof v === "string" && v.length > 0) {
      const enc = safeStorage.encrypt(v);
      if (enc !== undefined) {
        (clone as unknown as Record<string, unknown>)[key] = enc;
      }
    }
  }

  if (Array.isArray(clone.providers)) {
    for (const provider of clone.providers) {
      for (const key of PROVIDER_SECRETS) {
        const v = provider[key];
        if (typeof v === "string" && v.length > 0) {
          const enc = safeStorage.encrypt(v);
          if (enc !== undefined) {
            (provider as unknown as Record<string, unknown>)[key] = enc;
          }
        }
      }
    }
  }

  return clone;
}

/**
 * Decrypt every secret field in place on the loaded settings. Called
 * directly after loadData() in loadSettings(). A value that doesn't
 * start with "enc:v1:" is returned as-is so legacy plaintext settings
 * (from before this fix shipped) keep working until the next save
 * encrypts them.
 */
export function decryptSettingsAfterLoad(
  settings: FrontmatterEditorSettings,
  safeStorage: SafeStorageService,
): void {
  for (const key of TOP_LEVEL_SECRETS) {
    const v = settings[key];
    if (typeof v === "string" && v.length > 0) {
      const dec = safeStorage.decrypt(v);
      if (dec !== undefined) {
        (settings as unknown as Record<string, unknown>)[key] = dec;
      }
    }
  }
  if (Array.isArray(settings.providers)) {
    for (const provider of settings.providers) {
      for (const key of PROVIDER_SECRETS) {
        const v = provider[key];
        if (typeof v === "string" && v.length > 0) {
          const dec = safeStorage.decrypt(v);
          if (dec !== undefined) {
            (provider as unknown as Record<string, unknown>)[key] = dec;
          }
        }
      }
    }
  }
}

/**
 * Asserts a settings blob (as it would be written to disk) contains
 * no plaintext secret value. Used by tests + a one-time guard in
 * onload to flag the case where the encrypt step regressed.
 */
export function assertNoPlaintextSecrets(
  serialised: FrontmatterEditorSettings,
): string[] {
  const offenders: string[] = [];
  for (const key of TOP_LEVEL_SECRETS) {
    const v = serialised[key];
    if (typeof v === "string" && v.length > 0 && !v.startsWith("enc:v1:")) {
      offenders.push(String(key));
    }
  }
  if (Array.isArray(serialised.providers)) {
    for (const provider of serialised.providers) {
      for (const key of PROVIDER_SECRETS) {
        const v = provider[key];
        if (typeof v === "string" && v.length > 0 && !v.startsWith("enc:v1:")) {
          offenders.push(`providers[${provider.id ?? "?"}].${String(key)}`);
        }
      }
    }
  }
  return offenders;
}
