/**
 * Pure AWS Signature Version 4 signer. Used for Bedrock Control Plane
 * (ListInferenceProfiles, ListFoundationModels) and bedrock-runtime
 * (InvokeModel) when the user configures the access-key auth mode.
 *
 * Reference:
 *  https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html
 *  https://docs.aws.amazon.com/general/latest/gr/sigv4-create-string-to-sign.html
 *  https://docs.aws.amazon.com/general/latest/gr/sigv4-calculate-signature.html
 *
 * Signing is HMAC-SHA256 via the WebCrypto SubtleCrypto API. The plugin
 * runs in Obsidian's Electron renderer which has SubtleCrypto under
 * window.crypto; no Node-only `crypto` imports are used.
 */

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SigV4SignOptions {
  method: string;
  url: string;
  region: string;
  service: string;
  /** Stringified request body for POST/PUT; empty string for GET. */
  body?: string;
  /** Caller-supplied "now" for deterministic tests. Defaults to new Date(). */
  now?: Date;
  /** Additional headers to include in the signature (e.g. Content-Type for JSON POSTs). */
  extraHeaders?: Record<string, string>;
  credentials: SigV4Credentials;
}

export interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

export async function signSigV4(
  opts: SigV4SignOptions,
): Promise<SignedRequest> {
  const now = opts.now ?? new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = formatDateStamp(now);
  const parsed = new URL(opts.url);

  const body = opts.body ?? "";
  const payloadHash = await sha256Hex(body);

  const canonicalUri = canonicalizePath(parsed.pathname || "/");
  const canonicalQuery = canonicalizeQuery(parsed.searchParams);

  const headers: Record<string, string> = {
    ...(opts.extraHeaders ?? {}),
    host: parsed.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };
  if (opts.credentials.sessionToken) {
    headers["x-amz-security-token"] = opts.credentials.sessionToken;
  }

  // Build the canonical headers in lowercase, sorted, trimmed.
  const headerEntries = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), collapseWs(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalHeaders =
    headerEntries.map(([k, v]) => `${k}:${v}\n`).join("") || "";
  const signedHeaders = headerEntries.map(([k]) => k).join(";");

  const canonicalRequest = [
    opts.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`;
  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");

  const kDate = await hmac(
    new TextEncoder().encode(`AWS4${opts.credentials.secretAccessKey}`),
    dateStamp,
  );
  const kRegion = await hmac(kDate, opts.region);
  const kService = await hmac(kRegion, opts.service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = await hmacHex(kSigning, stringToSign);

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${opts.credentials.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  return {
    url: opts.url,
    method: opts.method.toUpperCase(),
    headers: {
      ...headers,
      Authorization: authorization,
    },
  };
}

// ----------------------------------------------------------- helpers

function canonicalizePath(path: string): string {
  // Idempotent: decode each segment first so already-percent-encoded
  // characters in the input URL are not double-encoded. URL.pathname
  // preserves the percent-encoded form of any reserved character that the
  // caller has pre-encoded (e.g. `:` in a Bedrock model id `claude-...v1:0`
  // ends up as `%3A` in pathname). Without the decode step the canonical
  // path would carry `%253A` while the wire path carries `%3A`, producing
  // SignatureDoesNotMatch.
  return path
    .split("/")
    .map((s) => awsEncodeURIComponent(decodeSegment(s)))
    .join("/");
}

function decodeSegment(s: string): string {
  // decodeURIComponent throws on malformed sequences; treat those as raw.
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function canonicalizeQuery(params: URLSearchParams): string {
  const entries: Array<[string, string]> = [];
  params.forEach((v, k) => {
    entries.push([k, v]);
  });
  entries.sort((a, b) => {
    if (a[0] === b[0]) return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
    return a[0] < b[0] ? -1 : 1;
  });
  return entries
    .map(([k, v]) => `${awsEncodeURIComponent(k)}=${awsEncodeURIComponent(v)}`)
    .join("&");
}

function awsEncodeURIComponent(s: string): string {
  // After decodeSegment() the input contains zero raw `/`, so we do not need
  // the allowSlash branch. AWS variant: also encode !'()* which the default
  // encodeURIComponent leaves untouched.
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function collapseWs(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function formatAmzDate(d: Date): string {
  // YYYYMMDDTHHmmssZ
  const iso = d.toISOString();
  return (
    iso.slice(0, 4) +
    iso.slice(5, 7) +
    iso.slice(8, 10) +
    "T" +
    iso.slice(11, 13) +
    iso.slice(14, 16) +
    iso.slice(17, 19) +
    "Z"
  );
}

export function formatDateStamp(d: Date): string {
  const iso = d.toISOString();
  return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10);
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return toHex(new Uint8Array(buf));
}

async function hmac(
  key: ArrayBuffer | Uint8Array,
  message: string,
): Promise<ArrayBuffer> {
  const keyBytes = key instanceof Uint8Array ? key : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

async function hmacHex(
  key: ArrayBuffer | Uint8Array,
  message: string,
): Promise<string> {
  const buf = await hmac(key, message);
  return toHex(new Uint8Array(buf));
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}
