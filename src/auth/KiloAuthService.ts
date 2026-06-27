import { Notice, requestUrl } from "obsidian";
import type FrontmatterEditorPlugin from "../main";

/**
 * Kilo Gateway. Two modes:
 *  - device-auth: kilo.ai's device-code flow (analogous to GitHub's).
 *  - manual-token: user pastes a long-lived API token.
 *
 * The plugin stores only token + org-id; refresh isn't required (tokens are
 * issued long-lived).
 */

const KILO_API = "https://api.kilo.ai";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 180;

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval?: number;
}

interface TokenResponse {
  access_token?: string;
  error?: string;
}

export class KiloAuthService {
  constructor(private plugin: FrontmatterEditorPlugin) {}

  async signInWithDeviceFlow(
    onUserCode: (info: { userCode: string; verificationUri: string }) => void,
  ): Promise<void> {
    const code = await this.requestDeviceCode();
    onUserCode({ userCode: code.user_code, verificationUri: code.verification_uri });
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await wait(Math.max(POLL_INTERVAL_MS, (code.interval ?? 5) * 1000));
      const token = await this.tryExchange(code.device_code);
      if (token?.access_token) {
        this.plugin.settings.kiloToken = token.access_token;
        this.plugin.settings.kiloAuthMode = "device-auth";
        await this.plugin.saveSettings();
        new Notice("Kilo Gateway authorized.");
        return;
      }
    }
    throw new Error("Kilo device flow timed out.");
  }

  async setManualToken(token: string, orgId?: string): Promise<void> {
    this.plugin.settings.kiloToken = token;
    this.plugin.settings.kiloAuthMode = "manual-token";
    if (orgId !== undefined) {
      this.plugin.settings.kiloOrganizationId = orgId;
    }
    await this.plugin.saveSettings();
  }

  async signOut(): Promise<void> {
    this.plugin.settings.kiloToken = undefined;
    this.plugin.settings.kiloAuthMode = "";
    this.plugin.settings.kiloOrganizationId = undefined;
    await this.plugin.saveSettings();
  }

  getToken(): string | undefined {
    return this.plugin.settings.kiloToken;
  }

  getOrgId(): string | undefined {
    return this.plugin.settings.kiloOrganizationId;
  }

  private async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const resp = await requestUrl({
      url: `${KILO_API}/api/device-auth/codes`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      throw: false,
    });
    if (resp.status >= 300) {
      throw new Error(`Kilo device code request failed: ${resp.status}`);
    }
    return resp.json as DeviceCodeResponse;
  }

  private async tryExchange(deviceCode: string): Promise<TokenResponse | null> {
    const resp = await requestUrl({
      url: `${KILO_API}/api/device-auth/token`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
      throw: false,
    });
    if (resp.status >= 400) {
      const json = resp.json as TokenResponse;
      if (json?.error === "authorization_pending" || json?.error === "slow_down") {
        return null;
      }
      throw new Error(json?.error ?? `Kilo token exchange ${resp.status}`);
    }
    return resp.json as TokenResponse;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
