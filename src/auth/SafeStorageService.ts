import { Notice } from "obsidian";

/**
 * Electron safeStorage wrapper. Returns "enc:v1:<base64>" prefixes when the
 * platform keychain is available (macOS Keychain Services, Windows DPAPI,
 * Linux libsecret); otherwise passes through plaintext with a single Notice
 * warning per session.
 *
 * Mirrors the Vault Operator SafeStorageService contract.
 */

const PREFIX = "enc:v1:";

let warnedThisSession = false;

interface ElectronSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

function getSafeStorage(): ElectronSafeStorage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- electron is a runtime-only import in Obsidian
    const electron = (window as unknown as { require?: (id: string) => unknown }).require?.("electron");
    if (!electron) return null;
    const remote = (electron as { remote?: { safeStorage?: ElectronSafeStorage } }).remote;
    const direct = (electron as { safeStorage?: ElectronSafeStorage }).safeStorage;
    return direct ?? remote?.safeStorage ?? null;
  } catch {
    return null;
  }
}

export class SafeStorageService {
  private safeStorage: ElectronSafeStorage | null;

  constructor() {
    this.safeStorage = getSafeStorage();
  }

  isAvailable(): boolean {
    return !!this.safeStorage?.isEncryptionAvailable();
  }

  encrypt(plain: string | undefined): string | undefined {
    if (plain === undefined || plain === null || plain === "") return plain;
    if (typeof plain !== "string") return plain;
    if (plain.startsWith(PREFIX)) return plain; // already encrypted
    if (!this.safeStorage?.isEncryptionAvailable()) {
      this.notifyPlaintextFallbackOnce();
      return plain;
    }
    try {
      const buf = this.safeStorage.encryptString(plain);
      return PREFIX + buf.toString("base64");
    } catch (err) {
      console.warn("frontmatter-editor: safeStorage encrypt failed", err);
      this.notifyPlaintextFallbackOnce();
      return plain;
    }
  }

  decrypt(value: string | undefined): string | undefined {
    if (!value) return value;
    if (!value.startsWith(PREFIX)) return value;
    if (!this.safeStorage?.isEncryptionAvailable()) {
      return undefined;
    }
    try {
      const base64 = value.slice(PREFIX.length);
      const buf = Buffer.from(base64, "base64");
      return this.safeStorage.decryptString(buf);
    } catch (err) {
      console.warn("frontmatter-editor: safeStorage decrypt failed", err);
      return undefined;
    }
  }

  private notifyPlaintextFallbackOnce(): void {
    if (warnedThisSession) return;
    warnedThisSession = true;
    new Notice(
      "Frontmatter Editor: OS keychain unavailable -- API keys are stored as plaintext in this vault's data.json. Restrict file access accordingly.",
      8_000,
    );
  }
}
