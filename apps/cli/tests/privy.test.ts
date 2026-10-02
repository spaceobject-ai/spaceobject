import crypto from "node:crypto";
import { PRIVY_APP_ID } from "@spaceobject/core";
import canonicalize from "canonicalize";
import { expect, test } from "vite-plus/test";
import { authorizationSignature } from "../src/lib/privy.ts";

const url = "https://auth.privy.io/api/oauth/v2/wallets/wallet_abc123/rpc";
const body = { method: "personal_sign", params: { message: "hello", encoding: "utf-8" } };

function createAuthorizationKey() {
  return crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { type: "pkcs8", format: "der" },
    publicKeyEncoding: { type: "spki", format: "der" },
  });
}

// Stands in for Privy: rebuilds the signature payload from the request it would
// have received and verifies it over the RFC 8785 canonical form.
function verify(publicKey: Buffer, signature: string, signedBody: unknown) {
  const payload = canonicalize({
    version: 1,
    method: "POST",
    url,
    body: signedBody,
    headers: { "privy-app-id": PRIVY_APP_ID },
  });

  return crypto.verify(
    "sha256",
    Buffer.from(payload ?? ""),
    crypto.createPublicKey({ key: publicKey, format: "der", type: "spki" }),
    Buffer.from(signature, "base64"),
  );
}

test("signs the request so Privy can verify it", () => {
  const keyPair = createAuthorizationKey();
  const signature = authorizationSignature(keyPair.privateKey.toString("base64"), url, body);

  expect(verify(keyPair.publicKey, signature, body)).toBe(true);
});

test("the signature does not cover a tampered request body", () => {
  const keyPair = createAuthorizationKey();
  const signature = authorizationSignature(keyPair.privateKey.toString("base64"), url, body);

  const tampered = { method: "personal_sign", params: { message: "goodbye", encoding: "utf-8" } };
  expect(verify(keyPair.publicKey, signature, tampered)).toBe(false);
});

test("signs key order independently, matching canonicalization", () => {
  const keyPair = createAuthorizationKey();
  const signature = authorizationSignature(keyPair.privateKey.toString("base64"), url, {
    params: { encoding: "utf-8", message: "hello" },
    method: "personal_sign",
  });

  expect(verify(keyPair.publicKey, signature, body)).toBe(true);
});
