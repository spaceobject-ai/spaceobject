import { PRIVY_APP_ID } from "@spaceobject/core";
import type { Context } from "hono";
import { problemDetails } from "hono-problem-details";
import { z } from "zod";
import type { Env } from "../env";

export const PRIVY_JWKS_URL = "https://auth.privy.io/.well-known/jwks.json";

const jwksSchema = z.object({
  keys: z.array(z.object({ kid: z.string(), kty: z.string(), n: z.string(), e: z.string() })),
});

export type Jwks = z.infer<typeof jwksSchema>;

const headerSchema = z.object({ alg: z.literal("RS256"), kid: z.string() });

// `aud` arrives as a string or a string array depending on the token source.
const claimsSchema = z.object({
  sub: z.string(),
  exp: z.number(),
  iss: z.string().optional(),
  aud: z.union([z.string(), z.array(z.string())]).optional(),
});

export type PrivyClaims = z.infer<typeof claimsSchema>;

// base64url decode via atob so the code runs in workerd and Node alike.
function base64UrlBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
    char.charCodeAt(0),
  );
}

function base64UrlJson(value: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}

// Signature check with WebCrypto; every failure path returns null so the caller
// can answer with a single 401 instead of distinguishing error shapes.
export async function verifyPrivyToken(token: string, jwks: Jwks): Promise<PrivyClaims | null> {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) return null;

  const header = headerSchema.safeParse(base64UrlJson(headerPart));
  if (!header.success) return null;

  const jwk = jwks.keys.find((candidate) => candidate.kid === header.data.kid);
  if (!jwk) return null;

  const claims = claimsSchema.safeParse(base64UrlJson(payloadPart));
  if (!claims.success) return null;
  if (claims.data.exp * 1000 <= Date.now()) return null;
  if (claims.data.iss !== undefined && claims.data.iss !== "privy.io") return null;

  const audience =
    typeof claims.data.aud === "string" ? [claims.data.aud] : (claims.data.aud ?? []);
  if (audience.length > 0 && !audience.includes(PRIVY_APP_ID)) return null;

  const key = await crypto.subtle
    .importKey(
      "jwk",
      { ...jwk, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    )
    .catch(() => null);
  if (key === null) return null;

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlBytes(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );

  return valid ? claims.data : null;
}

// Privy rotates keys rarely and a stale key self-heals on the next deploy, so a
// per-isolate cache keyed by JWKS URL is enough.
const jwksCache = new Map<string, Jwks>();

async function loadJwks(url: string): Promise<Jwks> {
  const cached = jwksCache.get(url);
  if (cached !== undefined) return cached;

  const jwks = await fetch(url)
    .then((response) => (response.ok ? response.json() : null))
    .then((value) => jwksSchema.safeParse(value))
    .catch(() => ({ success: false as const }));

  if (!jwks.success)
    throw problemDetails({
      status: 502,
      title: "Bad gateway",
      detail: "Could not load Privy signing keys.",
      type: "Auth",
    });

  jwksCache.set(url, jwks.data);
  return jwks.data;
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

  const claims = await verifyPrivyToken(
    token,
    await loadJwks(c.env.PRIVY_JWKS_URL ?? PRIVY_JWKS_URL),
  );
  if (!claims) throw unauthorized;

  return claims.sub;
}
