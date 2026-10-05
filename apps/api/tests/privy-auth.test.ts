import { expect, test } from "vite-plus/test";
import { PRIVY_APP_ID } from "@spaceobject/core";
import { verifyPrivyToken, type Jwks } from "../src/lib/privy-auth.ts";

// WebCrypto only, so the tests run under Node and workerd alike. generateKey
// and exportKey return unions in @types/node, so the helpers narrow to the
// shapes the tests actually use.
async function rsaKeyPair() {
  const generated = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  if (!("publicKey" in generated)) throw new Error("expected a key pair");

  return generated;
}

async function publicJwk(key: CryptoKey): Promise<JsonWebKey> {
  const exported = await crypto.subtle.exportKey("jwk", key);
  if (exported instanceof ArrayBuffer) throw new Error("expected a jwk export");

  return exported;
}

async function makeSigningKey() {
  const pair = await rsaKeyPair();
  const jwk = await publicJwk(pair.publicKey);

  return {
    privateKey: pair.privateKey,
    jwks: {
      keys: [{ kid: "test-key", kty: jwk.kty ?? "RSA", n: jwk.n ?? "", e: jwk.e ?? "AQAB" }],
    } satisfies Jwks,
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function signToken(privateKey: CryptoKey, claims: Record<string, unknown>, kid = "test-key") {
  const header = toBase64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid })));
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );

  return `${header}.${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

test("accepts a token signed by a JWKS key with fresh expiry and privy claims", async () => {
  const { privateKey, jwks } = await makeSigningKey();
  const token = await signToken(privateKey, {
    sub: "did:privy:user-1",
    exp: Math.floor(Date.now() / 1000) + 60,
    iss: "privy.io",
    aud: [PRIVY_APP_ID],
  });

  await expect(verifyPrivyToken(token, jwks)).resolves.toMatchObject({ sub: "did:privy:user-1" });
});

test("rejects an expired token", async () => {
  const { privateKey, jwks } = await makeSigningKey();
  const token = await signToken(privateKey, {
    sub: "user",
    exp: Math.floor(Date.now() / 1000) - 10,
  });

  await expect(verifyPrivyToken(token, jwks)).resolves.toBeNull();
});

test("rejects a token signed by a key outside the JWKS", async () => {
  const { privateKey } = await makeSigningKey();
  const other = await makeSigningKey();
  const token = await signToken(privateKey, { sub: "user", exp: Date.now() / 1000 + 60 });

  await expect(verifyPrivyToken(token, other.jwks)).resolves.toBeNull();
});

test("rejects a token whose payload was tampered with", async () => {
  const { privateKey, jwks } = await makeSigningKey();
  const token = await signToken(privateKey, { sub: "user", exp: Date.now() / 1000 + 60 });
  const [header, , signature] = token.split(".");
  const forgedPayload = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({ sub: "attacker", exp: Math.floor(Date.now() / 1000) + 60 }),
    ),
  );

  await expect(
    verifyPrivyToken(`${header}.${forgedPayload}.${signature}`, jwks),
  ).resolves.toBeNull();
});

test("rejects a token issued for a different app", async () => {
  const { privateKey, jwks } = await makeSigningKey();
  const token = await signToken(privateKey, {
    sub: "user",
    exp: Math.floor(Date.now() / 1000) + 60,
    aud: ["someone-elses-app"],
  });

  await expect(verifyPrivyToken(token, jwks)).resolves.toBeNull();
});
