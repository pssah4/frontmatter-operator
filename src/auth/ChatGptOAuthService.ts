import { Notice, requestUrl } from "obsidian";
import type FrontmatterEditorPlugin from "../main";
import { startLoopbackServer } from "./PkceLoopbackServer";
import { openExternal } from "./openExternal";
import {
  decodeJwtClaims,
  findClaimInNestedObjects,
  readStringClaim,
} from "./jwt-decode";

/**
 * ChatGPT (Codex CLI) OAuth via PKCE.
 *
 * The Codex CLI public OAuth app registers `http://localhost:1455/auth/callback`
 * as redirect URI. We need to bind exactly that port; if it's taken we fail
 * fast with a clear error.
 */

const AUTH_HOST = "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const SCOPE = "openid profile email offline_access";
const LOOPBACK_PORT = 1455;
const REDIRECT_URI = `http://localhost:${LOOPBACK_PORT}/auth/callback`;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export interface ChatGptSignInController {
  setStatus: (text: string) => void;
  /** Optional: shows a fallback "click to authorize" link if openExternal fails. */
  showAuthLink?: (url: string) => void;
  signal?: AbortSignal;
}

export class ChatGptOAuthService {
  constructor(private plugin: FrontmatterEditorPlugin) {}

  async signIn(controller: ChatGptSignInController): Promise<void> {
    controller.setStatus("Starting loopback server on port 1455...");
    let server: Awaited<ReturnType<typeof startLoopbackServer>>;
    try {
      server = await startLoopbackServer(LOOPBACK_PORT);
    } catch (err) {
      throw new Error(
        `Loopback server failed (port ${LOOPBACK_PORT} may be in use): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    try {
      const verifier = base64UrlEncode(randomBytes(64));
      const challenge = await sha256Base64Url(verifier);
      const state = base64UrlEncode(randomBytes(16));
      const params = new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
      });
      const url = `${AUTH_HOST}/oauth/authorize?${params.toString()}`;

      controller.setStatus("Opening browser for authorization...");
      const opened = openExternal(url);
      if (!opened) {
        controller.showAuthLink?.(url);
        controller.setStatus(
          "Could not open browser automatically. Click the link above.",
        );
      } else {
        controller.setStatus(
          `Waiting for browser callback to ${REDIRECT_URI} (you can copy this link manually if needed).`,
        );
      }

      // Race against the abort signal.
      const callback = await raceWithAbort(
        server.waitForCode(),
        controller.signal,
      );
      // L-1 (AUDIT v0.2.0): validate the echoed `state` against the value we
      // generated. Without this the CSRF token is decorative and a forged
      // callback to the fixed loopback port could inject an auth code.
      if (callback.state !== state) {
        throw new Error(
          "OAuth state mismatch -- aborting (possible CSRF / forged callback).",
        );
      }
      controller.setStatus("Exchanging code for tokens...");
      const tokens = await this.exchangeCode(callback.code, verifier);
      await this.persist(tokens);
      controller.setStatus("Authorized.");
    } finally {
      server.close();
    }
  }

  getAccountId(): string {
    return this.plugin.settings.chatgptOAuthAccountId ?? "";
  }

  /**
   * Invalidate the access token (used after a 401 from the codex backend
   * so the next request triggers a refresh). Refresh token stays.
   */
  invalidateAccessToken(): void {
    this.plugin.settings.chatgptOAuthAccessToken = undefined;
    this.plugin.settings.chatgptOAuthExpiresAt = 0;
    void this.plugin.saveSettings();
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
      // VO recovery path: a sign-in captured before the nested-claim fix
      // leaves accountId empty, which then drops the chatgpt-account-id
      // header and 403s every codex request. Re-derive from the existing
      // tokens instead of forcing a re-login.
      if (!this.plugin.settings.chatgptOAuthAccountId) {
        const recovered = this.deriveAccountId(
          this.plugin.settings.chatgptOAuthIdToken,
          this.plugin.settings.chatgptOAuthAccessToken,
        );
        if (recovered) {
          this.plugin.settings.chatgptOAuthAccountId = recovered;
          await this.plugin.saveSettings();
        }
      }
      return this.plugin.settings.chatgptOAuthAccessToken;
    }
    if (!this.plugin.settings.chatgptOAuthRefreshToken) return undefined;
    await this.refresh();
    return this.plugin.settings.chatgptOAuthAccessToken;
  }

  private async exchangeCode(
    code: string,
    verifier: string,
  ): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }).toString();

    const resp = await requestUrl({
      url: `${AUTH_HOST}/oauth/token`,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      throw: false,
    });
    if (resp.status >= 300) {
      throw new Error(
        `Token exchange failed: HTTP ${resp.status} -- ${resp.text}`,
      );
    }
    const json = resp.json as TokenResponse;
    if (json.error) {
      throw new Error(json.error_description ?? json.error);
    }
    return json;
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
    }
    // VO learning: the chatgpt-account-id and email claims may live on the
    // id_token, the access_token, or only inside the nested
    // https://api.openai.com/auth object. Try both tokens, both flat and
    // nested. Without account-id every codex/responses request 403s.
    const accountId = this.deriveAccountId(
      tokens.id_token,
      tokens.access_token,
    );
    if (accountId) {
      this.plugin.settings.chatgptOAuthAccountId = accountId;
    }
    const email = this.deriveEmail(tokens.id_token, tokens.access_token);
    if (email) {
      this.plugin.settings.chatgptOAuthEmail = email;
    }
    if (tokens.expires_in) {
      this.plugin.settings.chatgptOAuthExpiresAt =
        Date.now() + tokens.expires_in * 1000;
    }
    await this.plugin.saveSettings();
  }

  private deriveAccountId(
    idToken: string | undefined,
    accessToken: string | undefined,
  ): string {
    for (const jwt of [idToken, accessToken]) {
      if (!jwt) continue;
      const claims = decodeJwtClaims(jwt);
      if (!claims) continue;
      const fromKnown = readStringClaim(
        claims,
        "https://api.openai.com/auth.chatgpt_account_id",
        "chatgpt_account_id",
        "account_id",
      );
      if (fromKnown) return fromKnown;
      const fromDeep = findClaimInNestedObjects(
        claims,
        "chatgpt_account_id",
        "account_id",
      );
      if (fromDeep) return fromDeep;
    }
    return "";
  }

  private deriveEmail(
    idToken: string | undefined,
    accessToken: string | undefined,
  ): string {
    for (const jwt of [idToken, accessToken]) {
      if (!jwt) continue;
      const claims = decodeJwtClaims(jwt);
      if (!claims) continue;
      const email = readStringClaim(claims, "email");
      if (email) return email;
    }
    return "";
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

function raceWithAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new Error("Aborted"));
      signal.removeEventListener("abort", onAbort);
    };
    if (signal.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    signal.addEventListener("abort", onAbort);
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
