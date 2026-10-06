import { expect, test } from "vite-plus/test";
import { PRIVY_APP_ID } from "@spaceobject/core";
import { verifyPrivyToken, type EcJwk } from "../src/lib/privy-auth.ts";

// WebCrypto only, so the tests run under Node and workerd alike. generateKey
// and exportKey return unions in @types/node, so the helpers narrow to the
// shapes the tests actually use.
async function makeSigningKey(kid: string): Promise<{ privateKey: CryptoKey; jwk: EcJwk }> {
  const generated = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  if (!("publicKey" in generated)) throw new Error("expected a key pair");

  const exported = await crypto.subtle.exportKey("jwk", generated.publicKey);
  const jwk = exported instanceof ArrayBuffer ? null : exported;
  if (jwk === null || jwk.x === undefined || jwk.y === undefined)
    throw new Error("expected a jwk export");

  return {
    privateKey: generated.privateKey,
    jwk: {
      kty: "EC",
      crv: "P-256",
      x: jwk.x,
      y: jwk.y,
      kid,
      alg: "ES256",
    },
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function signToken(privateKey: CryptoKey, claims: Record<string, unknown>, kid: string) {
  const header = toBase64Url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid })));
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  // JOSE ES256 signatures are raw r||s, which is what WebCrypto emits and
  // accepts directly.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );

  return `${header}.${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

test("accepts a CLI-style token: ES256, privy:<app id> issuer, app audience", async () => {
  const pair = await makeSigningKey("test-key");
  const token = await signToken(
    pair.privateKey,
    {
      sub: "did:privy:user-1",
      exp: Math.floor(Date.now() / 1000) + 60,
      iss: `privy:${PRIVY_APP_ID}`,
      aud: PRIVY_APP_ID,
      grant: "device_code",
    },
    pair.jwk.kid,
  );

  await expect(verifyPrivyToken(token, [pair.jwk])).resolves.toMatchObject({
    sub: "did:privy:user-1",
  });
});

test("accepts a browser-style token with the privy.io issuer", async () => {
  const pair = await makeSigningKey("test-key");
  const token = await signToken(
    pair.privateKey,
    {
      sub: "user-2",
      exp: Math.floor(Date.now() / 1000) + 60,
      iss: "privy.io",
      aud: [PRIVY_APP_ID],
    },
    pair.jwk.kid,
  );

  await expect(verifyPrivyToken(token, [pair.jwk])).resolves.toMatchObject({ sub: "user-2" });
});

test("selects the matching key from a multi-key JWKS", async () => {
  const other = await makeSigningKey("other-key");
  const pair = await makeSigningKey("test-key");
  const token = await signToken(
    pair.privateKey,
    {
      sub: "user-3",
      exp: Math.floor(Date.now() / 1000) + 60,
    },
    pair.jwk.kid,
  );

  await expect(verifyPrivyToken(token, [other.jwk, pair.jwk])).resolves.toMatchObject({
    sub: "user-3",
  });
});

test("rejects an expired token", async () => {
  const pair = await makeSigningKey("test-key");
  const token = await signToken(
    pair.privateKey,
    {
      sub: "user",
      exp: Math.floor(Date.now() / 1000) - 10,
    },
    pair.jwk.kid,
  );

  await expect(verifyPrivyToken(token, [pair.jwk])).resolves.toBeNull();
});

test("rejects a token whose kid is not in the JWKS", async () => {
  const pair = await makeSigningKey("test-key");
  const token = await signToken(
    pair.privateKey,
    {
      sub: "user",
      exp: Math.floor(Date.now() / 1000) + 60,
    },
    "unknown-kid",
  );

  await expect(verifyPrivyToken(token, [pair.jwk])).resolves.toBeNull();
});

test("rejects a token whose payload was tampered with", async () => {
  const pair = await makeSigningKey("test-key");
  const token = await signToken(
    pair.privateKey,
    {
      sub: "user",
      exp: Math.floor(Date.now() / 1000) + 60,
    },
    pair.jwk.kid,
  );
  const [header, , signature] = token.split(".");
  const forgedPayload = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({ sub: "attacker", exp: Math.floor(Date.now() / 1000) + 60 }),
    ),
  );

  await expect(
    verifyPrivyToken(`${header}.${forgedPayload}.${signature}`, [pair.jwk]),
  ).resolves.toBeNull();
});

test("rejects a token issued for a different app", async () => {
  const pair = await makeSigningKey("test-key");
  const token = await signToken(
    pair.privateKey,
    {
      sub: "user",
      exp: Math.floor(Date.now() / 1000) + 60,
      aud: "someone-elses-app",
    },
    pair.jwk.kid,
  );

  await expect(verifyPrivyToken(token, [pair.jwk])).resolves.toBeNull();
});
