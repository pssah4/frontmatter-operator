/**
 * Minimal JWT claim decoder, ported 1:1 from Vault Operator.
 * Reads claims without verifying the signature. Safe here because the
 * token comes directly from auth.openai.com over TLS in the OAuth code
 * exchange.
 */

export type JwtClaims = Record<string, unknown>;

export function decodeJwtClaims(jwt: string): JwtClaims | null {
  if (!jwt || typeof jwt !== "string") return null;
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = base64UrlDecode(parts[1]);
    const parsed = JSON.parse(payload) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as JwtClaims;
    }
    return null;
  } catch {
    return null;
  }
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const base64 = padded + "=".repeat(padLength);
  // Buffer is available in Obsidian's Electron renderer.
  return Buffer.from(base64, "base64").toString("utf-8");
}

const NESTED_CLAIM_NAMESPACES = ["https://api.openai.com/auth"];

export function readStringClaim(claims: JwtClaims, ...names: string[]): string {
  for (const name of names) {
    const direct = claims[name];
    if (typeof direct === "string" && direct.length > 0) return direct;

    for (const ns of NESTED_CLAIM_NAMESPACES) {
      const prefix = ns + ".";
      if (!name.startsWith(prefix)) continue;
      const obj = claims[ns];
      if (!obj || typeof obj !== "object") continue;
      const field = name.slice(prefix.length);
      const nested = (obj as Record<string, unknown>)[field];
      if (typeof nested === "string" && nested.length > 0) return nested;
    }
  }
  return "";
}

export function findClaimInNestedObjects(
  claims: JwtClaims,
  ...fieldNames: string[]
): string {
  for (const value of Object.values(claims)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const obj = value as Record<string, unknown>;
    for (const field of fieldNames) {
      const v = obj[field];
      if (typeof v === "string" && v.length > 0) return v;
    }
  }
  return "";
}
