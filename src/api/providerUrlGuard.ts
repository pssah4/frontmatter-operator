/**
 * Provider-URL transport guard. L-2 (AUDIT v0.2.0 re-audit 2026-06-29):
 * every credential-bearing request attaches a Bearer token / API key to a
 * URL that comes from `provider.baseUrl` (user-editable settings). Before
 * this guard there was no scheme or host check, so:
 *   - an `http://` typo for a remote host sent the credential in cleartext;
 *   - nothing stopped a request at a cloud-metadata endpoint (IMDS).
 *
 * The 2026-06-29 baseline audit credited a `providerUrlGuard.ts` with
 * exactly this job, but the file never existed (`git log -S 169.254.169.254`
 * showed the literal only in the audit markdown). This is that file, now real.
 *
 * Policy:
 *   - https:// is always allowed (cloud-metadata hosts excepted).
 *   - http:// is allowed ONLY for local model servers (ollama / lmstudio /
 *     custom) talking to a loopback host. Everything else over http:// is
 *     rejected so a credential never leaves the machine in cleartext.
 *   - Cloud-metadata / link-local hosts are blocked for every provider.
 */

import { ProviderError } from "../types/llm";
import type { ProviderType } from "../types/llm";

/** Provider types that legitimately reach a local model server over http. */
const LOCAL_HTTP_ALLOWED: ReadonlySet<string> = new Set([
  "ollama",
  "lmstudio",
  "custom",
]);

/** Loopback hosts that count as "local" for the http exception. L-1 (AUDIT
 *  2026-07-01): `0.0.0.0` ("all interfaces") removed -- it is never a legitimate
 *  client destination and only widened the cleartext-http exception. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
]);

/**
 * Hosts a credentialed request must never reach. Cloud instance-metadata
 * endpoints (IMDS) and the GCP metadata name -- a request here would hand a
 * SSRF-style attacker cloud role credentials.
 */
const BLOCKED_HOSTS: ReadonlySet<string> = new Set([
  "169.254.169.254", // AWS / Azure / GCP IMDS (IPv4)
  "fd00:ec2::254", // AWS IMDS (IPv6)
  "metadata.google.internal", // GCP metadata
]);

/**
 * Canonicalize a URL hostname so the blocklist cannot be evaded by cosmetic
 * variants. L-1 (AUDIT 2026-07-02): `new URL()` keeps a trailing dot on
 * DOMAIN names (`metadata.google.internal.`) and wraps IPv6 literals in
 * brackets (`[fe80::1]`); both slipped past the exact-string blocklist.
 * (Decimal / hex / octal IPv4 encodings of IMDS are already normalized to
 * `169.254.169.254` by the WHATWG URL parser, so they need no extra handling.)
 */
function canonicalizeHost(rawHost: string): string {
  let host = rawHost.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

/**
 * A host that must never receive a credentialed request: the exact blocklist
 * plus the IPv4 link-local range (169.254.0.0/16, covers IMDS and the ECS/EKS
 * task-metadata siblings) and IPv6 link-local (fe80::/10) and AWS's IMDS IPv6.
 */
function isBlockedHost(host: string): boolean {
  if (BLOCKED_HOSTS.has(host)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true; // IPv4 link-local /16
  if (/^fe[89ab][0-9a-f]:/.test(host) || host.startsWith("fe80:")) return true; // IPv6 fe80::/10
  if (host === "fd00:ec2::254") return true; // AWS IMDS (IPv6), de-bracketed
  return false;
}

/**
 * Throw a ProviderError unless `rawUrl` is a safe destination for a
 * credentialed request from the given provider type. Call this with the
 * final, fully-built request URL right before issuing the request.
 */
export function assertSafeProviderUrl(
  rawUrl: string,
  providerType: ProviderType,
): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProviderError(
      `Invalid provider URL: ${rawUrl}`,
      providerType,
    );
  }

  const host = canonicalizeHost(url.hostname);

  if (isBlockedHost(host)) {
    throw new ProviderError(
      `Provider URL host "${host}" is blocked (cloud metadata / link-local endpoint).`,
      providerType,
    );
  }

  if (url.protocol === "https:") return;

  if (url.protocol === "http:") {
    if (LOCAL_HOSTS.has(host) && LOCAL_HTTP_ALLOWED.has(providerType)) return;
    throw new ProviderError(
      LOCAL_HOSTS.has(host)
        ? `Plaintext http:// to a local host is only allowed for ollama/lmstudio/custom, not "${providerType}".`
        : `Provider "${providerType}" must use https:// -- http:// to "${host}" would send credentials in cleartext.`,
      providerType,
    );
  }

  throw new ProviderError(
    `Provider URL scheme "${url.protocol}" is not allowed (use https://).`,
    providerType,
  );
}
