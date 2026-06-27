import { Notice, requestUrl } from "obsidian";
import type FrontmatterEditorPlugin from "../main";
import { startLoopbackServer } from "./PkceLoopbackServer";

/**
 * ChatGPT (Codex CLI) OAuth -- PKCE flow against auth.openai.com.
 *
 * Phase A (this commit): full flow scaffolding -- PKCE pair, browser
 * redirect, loopback wait, code-for-token exchange, refresh.
 * Phase B (future): JWT id_token claim parsing for plan tier + account id.
 *
 * Real-world testing requires:
 *  - Working browser launch via window.open
 *  - Free localhost port
 *  - Reachable auth.openai.com / api.openai.com
 *  - User has a paid ChatGPT plan
 */

const AUTH_HOST = "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"; // codex-cli public client id
const SCOPE = "openid profile email offline_access";

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export class ChatGptOAuthService {
  constructor(private plugin: FrontmatterEditorPlugin) {}

  async signIn(): Promise<void> {
    const server = await startLoopbackServer();
    try {
      const verifier = base64UrlEncode(randomBytes(64));
      const challenge = await sha256Base64Url(verifier);
      const redirect = `http://127.0.0.1:${server.port}/callback`;
      const params = new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: redirect,
        scope: SCOPE,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      const url = `${AUTH_HOST}/oauth/authorize?${params.toString()}`;
      window.open(url, "_blank");
      const code = await server.waitForCode();
      const tokens = await this.exchangeCode(code, verifier, redirect);
      await this.persist(tokens);
      new Notice("ChatGPT account authorized.");
    } finally {
      server.close();
    }
  }

  async signOut(): Promise<void> {
    this.plugin.settings.chatgptOAuthAccessToken = undefined;
    this.plugin.settings.chatgptOAuthRefreshToken = undefined;
    this.plugin.settings.chatgptOAuthIdToken = undefined;
    this.plugin.settings.chatgptOAuthAccountId = undefined;
    this.plugin.settings.chatgptOAuthEmail = undefined;
    this.plugin.settings.chatgptOAuthExpiresAt = undefined;
    await this.plugin.saveSettings();
  }

  async getValidAccessToken(): Promise<string | undefined> {
    const exp = this.plugin.settings.chatgptOAuthExpiresAt ?? 0;
    const now = Date.now();
    if (this.plugin.settings.chatgptOAuthAccessToken && exp > now + 60_000) {
      return this.plugin.settings.chatgptOAuthAccessToken;
    }
    if (!this.plugin.settings.chatgptOAuthRefreshToken) return undefined;
    await this.refresh();
    return this.plugin.settings.chatgptOAuthAccessToken;
  }

  private async exchangeCode(
    code: string,
    verifier: string,
    redirect: string,
  ): Promise<TokenResponse> {
    const resp = await requestUrl({
      url: `${AUTH_HOST}/oauth/token`,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code,
        redirect_uri: redirect,
        code_verifier: verifier,
      }).toString(),
      throw: false,
    });
    if (resp.status >= 300) {
      throw new Error(`Token exchange failed: ${resp.status} ${resp.text}`);
    }
    return resp.json as TokenResponse;
  }

  private async refresh(): Promise<void> {
    const refresh = this.plugin.settings.chatgptOAuthRefreshToken;
    if (!refresh) return;
    const resp = await requestUrl({
      url: `${AUTH_HOST}/oauth/token`,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: refresh,
      }).toString(),
      throw: false,
    });
    if (resp.status >= 300) {
      throw new Error(`Refresh failed: ${resp.status}`);
    }
    await this.persist(resp.json as TokenResponse);
  }

  private async persist(tokens: TokenResponse): Promise<void> {
    if (tokens.access_token) {
      this.plugin.settings.chatgptOAuthAccessToken = tokens.access_token;
    }
    if (tokens.refresh_token) {
      this.plugin.settings.chatgptOAuthRefreshToken = tokens.refresh_token;
    }
    if (tokens.id_token) {
      this.plugin.settings.chatgptOAuthIdToken = tokens.id_token;
      const claims = parseIdToken(tokens.id_token);
      if (claims) {
        this.plugin.settings.chatgptOAuthEmail = claims.email;
        this.plugin.settings.chatgptOAuthAccountId =
          claims["https://api.openai.com/auth"]?.chatgpt_account_id;
      }
    }
    if (tokens.expires_in) {
      this.plugin.settings.chatgptOAuthExpiresAt =
        Date.now() + tokens.expires_in * 1000;
    }
    await this.plugin.saveSettings();
  }
}

interface IdTokenClaims {
  email?: string;
  "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
}

function parseIdToken(jwt: string): IdTokenClaims | null {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as IdTokenClaims;
  } catch {
    return null;
  }
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(buf));
}
