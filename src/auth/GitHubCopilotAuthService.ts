import { Notice, requestUrl } from "obsidian";
import type FrontmatterEditorPlugin from "../main";

/**
 * GitHub Copilot Device Flow.
 *
 * GitHub's OAuth API expects `application/x-www-form-urlencoded` form bodies
 * (not JSON) and `Accept: application/json` to return JSON. The polling
 * responds with `authorization_pending` until the user authorizes.
 *
 * Token chain:
 *  1. POST /login/device/code  -> user_code + verification_uri + device_code
 *  2. User authorizes via verification_uri
 *  3. POST /login/oauth/access_token -> github access_token
 *  4. GET /copilot_internal/v2/token -> ~1h Copilot bearer
 *  5. Auto refresh via step 4 before each completion.
 */

const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98"; // VS Code Copilot public client id
const SCOPE = "read:user copilot";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MAX_POLL_WAIT_MS = 15 * 60 * 1000;

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface AccessTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface CopilotTokenResponse {
  token: string;
  expires_at: number;
}

export interface CopilotSignInController {
  /** Called after step 1 with the human-facing code + verification URL. */
  showUserCode: (info: { userCode: string; verificationUri: string }) => void;
  setStatus: (text: string) => void;
  signal?: AbortSignal;
}

export class GitHubCopilotAuthService {
  constructor(private plugin: FrontmatterEditorPlugin) {}

  async signIn(controller: CopilotSignInController): Promise<void> {
    controller.setStatus("Requesting device code...");
    const code = await this.requestDeviceCode();
    controller.showUserCode({
      userCode: code.user_code,
      verificationUri: code.verification_uri,
    });
    controller.setStatus("Waiting for you to authorize in the browser...");

    const intervalMs = Math.max(DEFAULT_POLL_INTERVAL_MS, code.interval * 1000);
    const deadline = Date.now() + Math.min(code.expires_in * 1000, MAX_POLL_WAIT_MS);
    let pollIntervalMs = intervalMs;

    while (Date.now() < deadline) {
      if (controller.signal?.aborted) {
        throw new Error("Sign-in cancelled");
      }
      await wait(pollIntervalMs, controller.signal);
      const result = await this.tryExchangeAccessToken(code.device_code);
      if (result.token) {
        await this.persistAccessToken(result.token);
        controller.setStatus("Exchanging for Copilot token...");
        await this.refreshCopilotToken();
        controller.setStatus("Authorized.");
        return;
      }
      if (result.slowDown) {
        pollIntervalMs += 5_000;
        controller.setStatus(`Slow-down request from GitHub; waiting longer (${pollIntervalMs / 1000}s).`);
      } else if (result.error) {
        throw new Error(`GitHub: ${result.error}`);
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
    const body = encodeForm({
      client_id: COPILOT_CLIENT_ID,
      scope: SCOPE,
    });
    const resp = await requestUrl({
      url: "https://github.com/login/device/code",
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "FrontmatterEditorPlugin/0.1",
      },
      body,
      throw: false,
    });
    if (resp.status >= 300) {
      throw new Error(
        `Device code request failed: HTTP ${resp.status} -- ${resp.text}`,
      );
    }
    const json = resp.json as DeviceCodeResponse & {
      error?: string;
      error_description?: string;
    };
    if (json.error) {
      throw new Error(`GitHub: ${json.error_description ?? json.error}`);
    }
    return json;
  }

  private async tryExchangeAccessToken(
    deviceCode: string,
  ): Promise<{ token?: string; slowDown?: boolean; error?: string }> {
    const body = encodeForm({
      client_id: COPILOT_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    const resp = await requestUrl({
      url: "https://github.com/login/oauth/access_token",
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "FrontmatterEditorPlugin/0.1",
      },
      body,
      throw: false,
    });
    const json = resp.json as AccessTokenResponse;
    if (json?.access_token) {
      return { token: json.access_token };
    }
    if (json?.error === "authorization_pending") return {};
    if (json?.error === "slow_down") return { slowDown: true };
    if (json?.error) {
      return { error: json.error_description ?? json.error };
    }
    return { error: `Unexpected HTTP ${resp.status}` };
  }

  private async persistAccessToken(token: string): Promise<void> {
    this.plugin.settings.githubCopilotAccessToken = token;
    await this.plugin.saveSettings();
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
        "User-Agent": "FrontmatterEditorPlugin/0.1",
        "Editor-Version": "vscode/1.95.0",
        "Editor-Plugin-Version": "frontmatter-editor/0.1",
      },
      throw: false,
    });
    if (resp.status >= 300) {
      throw new Error(
        `Copilot token exchange failed: HTTP ${resp.status} -- ${resp.text}`,
      );
    }
    const json = resp.json as CopilotTokenResponse;
    this.plugin.settings.githubCopilotToken = json.token;
    this.plugin.settings.githubCopilotTokenExpiresAt = json.expires_at;
    await this.plugin.saveSettings();
  }
}

function encodeForm(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => resolve(), ms);
    if (signal) {
      const onAbort = () => {
        window.clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(new Error("Aborted"));
      };
      if (signal.aborted) {
        window.clearTimeout(timer);
        reject(new Error("Aborted"));
        return;
      }
      signal.addEventListener("abort", onAbort);
    }
  });
}
