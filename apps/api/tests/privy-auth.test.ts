import { expect, test } from "vite-plus/test";
import { verifyPrivyToken, type Jwks } from "../src/lib/privy-auth.ts";

// WebCrypto only, so the tests run under Node and workerd alike.
async function makeSigningKey() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
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
    aud: ["cmup54h2i01j80di4xu0x0fet"],
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
