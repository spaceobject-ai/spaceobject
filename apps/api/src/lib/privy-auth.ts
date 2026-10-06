import { PRIVY_APP_ID } from "@spaceobject/core";
import type { Context } from "hono";
import { problemDetails } from "hono-problem-details";
import { z } from "zod";
import type { Env } from "../env";

// Privy publishes each app's verification keys at
// api.privy.io/v1/apps/<app id>/jwks.json — public, unauthenticated, ES256
// EC JWKs (the same mechanism @privy-io/node uses via jose.createRemoteJWKSet).
const PRIVY_JWKS_URL = `https://api.privy.io/v1/apps/${PRIVY_APP_ID}/jwks.json`;

// Overridable so tests can serve their own JWKS from a local server; the
// default hits the real Privy endpoint.
let jwksUrlOverride: string | null = null;

export function setPrivyJwksUrl(url: string | null): void {
  jwksUrlOverride = url;
  cachedJwks = null;
}

// Per-isolate cache: Privy rotates keys rarely, and a stale entry self-heals
// on the next worker restart. Mirrors the SDK's 60-minute cache.
const JWKS_CACHE_MS = 60 * 60 * 1000;
let cachedJwks: { keys: EcJwk[]; fetchedAt: number } | null = null;

const ecJwkSchema = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: z.string(),
  y: z.string(),
  kid: z.string(),
  alg: z.literal("ES256"),
});

export type EcJwk = z.infer<typeof ecJwkSchema>;

const jwksSchema = z.object({ keys: z.array(ecJwkSchema) });

const claimsSchema = z.object({
  sub: z.string(),
  exp: z.number(),
  iss: z.string().optional(),
  // `aud` arrives as a string or a string array depending on the token source.
  aud: z.union([z.string(), z.array(z.string())]).optional(),
});

export type PrivyClaims = z.infer<typeof claimsSchema>;

// base64/base64url decode via atob so the code runs in workerd and Node alike.
function base64UrlBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
    char.charCodeAt(0),
  );
}

function base64UrlJson(value: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}

// WebCrypto takes an EC JWK almost verbatim; alg must not ride along for
// importKey("jwk", ...) with an ECDSA algorithm object.
function toWebCryptoJwk(jwk: EcJwk): JsonWebKey {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true };
}

async function loadJwks(): Promise<EcJwk[]> {
  if (cachedJwks !== null && Date.now() - cachedJwks.fetchedAt < JWKS_CACHE_MS)
    return cachedJwks.keys;

  const jwks = await fetch(jwksUrlOverride ?? PRIVY_JWKS_URL)
    .then((response) => (response.ok ? response.json() : null))
    .then((value) => jwksSchema.safeParse(value))
    .catch(() => ({ success: false as const }));

  if (!jwks.success)
    throw problemDetails({
      status: 502,
      title: "Bad gateway",
      detail: "Could not load the app's Privy verification keys.",
      type: "Auth",
    });

  cachedJwks = { keys: jwks.data.keys, fetchedAt: Date.now() };
  return jwks.data.keys;
}

// Signature check with WebCrypto; every failure path returns null so the caller
// can answer with a single 401 instead of distinguishing error shapes.
export async function verifyPrivyToken(token: string, keys: EcJwk[]): Promise<PrivyClaims | null> {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) return null;

  const header = z
    .object({ alg: z.literal("ES256"), kid: z.string() })
    .safeParse(base64UrlJson(headerPart));
  if (!header.success) return null;

  const jwk = keys.find((candidate) => candidate.kid === header.data.kid);
  if (!jwk) return null;

  const claims = claimsSchema.safeParse(base64UrlJson(payloadPart));
  if (!claims.success) return null;
  if (claims.data.exp * 1000 <= Date.now()) return null;

  // Browser flows issue `privy.io`; the CLI's device flow issues `privy:<app id>`.
  const issuer = claims.data.iss;
  if (issuer !== undefined && issuer !== "privy.io" && issuer !== `privy:${PRIVY_APP_ID}`)
    return null;

  const audience =
    typeof claims.data.aud === "string" ? [claims.data.aud] : (claims.data.aud ?? []);
  if (audience.length > 0 && !audience.includes(PRIVY_APP_ID)) return null;

  const key = await crypto.subtle
    .importKey("jwk", toWebCryptoJwk(jwk), { name: "ECDSA", namedCurve: "P-256" }, false, [
      "verify",
    ])
    .catch(() => null);
  if (key === null) return null;

  // JOSE ES256 signatures are raw r||s, which WebCrypto's verify() accepts as-is.
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64UrlBytes(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );

  return valid ? claims.data : null;
}

/** Answers 401 for anything but a valid Privy access token; returns its user id. */
export async function requirePrivyUser(c: Context<Env>): Promise<string> {
  const token = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  const unauthorized = problemDetails({
    status: 401,
    title: "Unauthorized",
    detail: "A valid Privy access token is required.",
    type: "Auth",
  });
  if (!token) throw unauthorized;

  const claims = await verifyPrivyToken(token, await loadJwks());
  if (!claims) throw unauthorized;

  return claims.sub;
}
