import { Notice, requestUrl } from "obsidian";
import type FrontmatterEditorPlugin from "../main";

/**
 * GitHub Copilot Device Flow.
 *
 * 1. POST /login/device/code  -> user_code + verification_uri + device_code
 * 2. User opens verification_uri, types the user_code, authorizes.
 * 3. We poll /login/oauth/access_token until success, then exchange the
 *    GitHub access_token for a short-lived Copilot token via
 *    /copilot_internal/v2/token.
 * 4. Copilot tokens last ~1h; we refresh transparently before completion.
 *
 * The state lives on the plugin's settings object. Encryption is handled
 * by the caller via SafeStorageService.
 */

const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98"; // public Copilot client id
const SCOPE = "read:user copilot";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 180; // ~15 min

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface AccessTokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
}

interface CopilotTokenResponse {
  token: string;
  expires_at: number;
}

export class GitHubCopilotAuthService {
  constructor(private plugin: FrontmatterEditorPlugin) {}

  /** Kick off the Device Flow. Resolves once the user is signed in. */
  async signIn(
    onUserCode: (info: { userCode: string; verificationUri: string }) => void,
  ): Promise<void> {
    const code = await this.requestDeviceCode();
    onUserCode({ userCode: code.user_code, verificationUri: code.verification_uri });

    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await wait(Math.max(POLL_INTERVAL_MS, code.interval * 1000));
      const token = await this.tryExchangeAccessToken(code.device_code);
      if (token) {
        await this.persistTokens(token, undefined, undefined);
        await this.refreshCopilotToken();
        new Notice("GitHub Copilot authorized.");
        return;
      }
    }
    throw new Error("Device flow timed out.");
  }

  async signOut(): Promise<void> {
    this.plugin.settings.githubCopilotAccessToken = undefined;
    this.plugin.settings.githubCopilotToken = undefined;
    this.plugin.settings.githubCopilotTokenExpiresAt = undefined;
    await this.plugin.saveSettings();
  }

  /** Returns a valid Copilot bearer token, refreshing if close to expiry. */
  async getValidCopilotToken(): Promise<string | undefined> {
    const exp = this.plugin.settings.githubCopilotTokenExpiresAt ?? 0;
    const now = Math.floor(Date.now() / 1000);
    if (this.plugin.settings.githubCopilotToken && exp > now + 60) {
      return this.plugin.settings.githubCopilotToken;
    }
    if (!this.plugin.settings.githubCopilotAccessToken) return undefined;
    await this.refreshCopilotToken();
    return this.plugin.settings.githubCopilotToken;
  }

  private async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const resp = await requestUrl({
      url: "https://github.com/login/device/code",
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "FrontmatterEditor/0.1",
      },
      body: JSON.stringify({ client_id: COPILOT_CLIENT_ID, scope: SCOPE }),
      throw: false,
    });
    if (resp.status >= 300) {
      throw new Error(`Device code request failed: ${resp.status} ${resp.text}`);
    }
    return resp.json as DeviceCodeResponse;
  }

  private async tryExchangeAccessToken(
    deviceCode: string,
  ): Promise<AccessTokenResponse | null> {
    const resp = await requestUrl({
      url: "https://github.com/login/oauth/access_token",
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "FrontmatterEditor/0.1",
      },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
      throw: false,
    });
    const json = resp.json as AccessTokenResponse;
    if (json?.access_token) return json;
    if (json?.error === "authorization_pending" || json?.error === "slow_down") {
      return null;
    }
    if (json?.error) throw new Error(json.error);
    return null;
  }

  private async refreshCopilotToken(): Promise<void> {
    const accessToken = this.plugin.settings.githubCopilotAccessToken;
    if (!accessToken) return;
    const resp = await requestUrl({
      url: "https://api.github.com/copilot_internal/v2/token",
      method: "GET",
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "FrontmatterEditor/0.1",
      },
      throw: false,
    });
    if (resp.status >= 300) {
      throw new Error(`Copilot token exchange failed: ${resp.status}`);
    }
    const json = resp.json as CopilotTokenResponse;
    this.plugin.settings.githubCopilotToken = json.token;
    this.plugin.settings.githubCopilotTokenExpiresAt = json.expires_at;
    await this.plugin.saveSettings();
  }

  private async persistTokens(
    res: AccessTokenResponse,
    _copilotToken?: string,
    _copilotExpiresAt?: number,
  ): Promise<void> {
    if (res.access_token) {
      this.plugin.settings.githubCopilotAccessToken = res.access_token;
    }
    await this.plugin.saveSettings();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
