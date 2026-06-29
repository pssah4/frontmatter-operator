/**
 * RFC 7230 header field validation. L-4 SAST (AUDIT 2026-06-29):
 * gateway / enterprise-proxy header names and values come from
 * user-editable settings. The Node http stack already throws on
 * CRLF (so wire-level header smuggling is structurally blocked),
 * but we want a settings-time error instead of a low-level
 * TypeError at the moment a request fires. Plus: certain header
 * names must NEVER be overwritten (Host, Content-Length,
 * Authorization, Transfer-Encoding) because the SDK / transport
 * derives them and a user typo would silently break the request
 * (or worse, leak credentials).
 */

/** RFC 7230 token character set for header field names. */
const TOKEN_CHAR_RE = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

/** Header names a user MUST NOT override via gateway-header settings. */
const FORBIDDEN_HEADER_NAMES: ReadonlySet<string> = new Set([
  "host",
  "content-length",
  "authorization",
  "transfer-encoding",
  "te",
  "connection",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
]);

/**
 * Validate a header name. Returns null if ok, otherwise a
 * human-readable error message for surfacing in a Notice.
 */
export function validateHeaderName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Header name cannot be empty.";
  if (!TOKEN_CHAR_RE.test(trimmed)) {
    return `Header name "${trimmed}" contains invalid characters (RFC 7230 token only).`;
  }
  if (FORBIDDEN_HEADER_NAMES.has(trimmed.toLowerCase())) {
    return `Header name "${trimmed}" is reserved and cannot be overridden via gateway settings.`;
  }
  return null;
}

/**
 * Validate a header value. Returns null if ok, otherwise an error
 * string. Rejects CR/LF (header smuggling), NUL bytes, and any
 * control character that isn't tab.
 */
export function validateHeaderValue(value: string): string | null {
  if (value.length === 0) return "Header value cannot be empty.";
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    // Allow tab (\\x09); reject every other control byte + CR/LF.
    if (ch === 0x09) continue;
    if (ch < 0x20 || ch === 0x7f) {
      return `Header value contains an invalid control character (code 0x${ch.toString(16)}).`;
    }
  }
  return null;
}

/**
 * Throws an Error with a user-readable message if the header name
 * or value is invalid. Used at provider construction so a bad
 * gateway-header setting fails fast with a clean error instead of
 * surfacing later as a Node TypeError mid-request.
 */
export function assertValidHeader(name: string, value: string): void {
  const nameError = validateHeaderName(name);
  if (nameError) throw new Error(nameError);
  const valueError = validateHeaderValue(value);
  if (valueError) throw new Error(valueError);
}
