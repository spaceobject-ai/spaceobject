import http from "node:http";
import { expect, test } from "vite-plus/test";
import { PRIVY_APP_ID } from "@spaceobject/core";
import { problemDetailsHandler } from "hono-problem-details";

import app from "../src/index.ts";
import type { WorkerSecrets } from "../src/env.ts";
import { setPrivyJwksUrl, type EcJwk } from "../src/lib/privy-auth.ts";

// Real local HTTP servers stand in for Privy's JWKS endpoint and QuickNode's
// API: the Worker's fetch code runs for real, only the remote end is ours.
async function withServer<T>(
  handler: http.RequestListener,
  run: (url: URL) => Promise<T>,
): Promise<T> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");

  try {
    return await run(new URL(`http://127.0.0.1:${address.port}`));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

const cid = "QmNScLLyNHuFTzDbKfxTS9JAggzdYve6FbNfH3xSqYURw7";
const deliverable = Buffer.from("test deliverable");

async function makeToken() {
  const generated = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  if (!("publicKey" in generated)) throw new Error("expected a key pair");

  const exported = await crypto.subtle.exportKey("jwk", generated.publicKey);
  const jwk = exported instanceof ArrayBuffer ? null : exported;
  if (jwk === null || jwk.x === undefined || jwk.y === undefined)
    throw new Error("expected a jwk export");

  const ecJwk: EcJwk = {
    kty: "EC",
    crv: "P-256",
    x: jwk.x,
    y: jwk.y,
    kid: "test-key",
    alg: "ES256",
  };

  const header = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: "test-key" })),
  );
  const payload = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        sub: "user-1",
        exp: Math.floor(Date.now() / 1000) + 60,
        iss: `privy:${PRIVY_APP_ID}`,
        aud: PRIVY_APP_ID,
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    generated.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );

  return { token: `${header}.${payload}.${toBase64Url(new Uint8Array(signature))}`, jwk: ecJwk };
}

// The app mounts the problem-details error handler; a bare handler export would
// turn thrown problemDetails into 500s, so the test targets the real app.
function makeApp() {
  const testApp = app;
  testApp.onError(problemDetailsHandler({ autoInstance: true }));
  return testApp;
}

// The generated CloudflareBindings types carry literal URL types from
// wrangler.jsonc; tests need the handler-shaped env instead.
type Bindings = {
  [K in keyof CloudflareBindings]: string;
} & WorkerSecrets;

function bindings(quicknodeUrl: string): Bindings {
  return {
    ERC_8004_SUBGRAPH_URL: "",
    ERC_8004_SUBGRAPH_API_KEY: "",
    ERC_8183_SUBGRAPH_URL: "",
    ERC_8183_SUBGRAPH_API_KEY: "",
    QUICKNODE_IPFS_API_URL: quicknodeUrl,
    QUICKNODE_IPFS_API_KEY: "test-key",
  };
}

test("upload pins through QuickNode and returns the CID", async () => {
  const { token, jwk } = await makeToken();
  const uploads: string[] = [];

  await withServer(
    async (request, response) => {
      if (request.url === "/jwks") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (request.url === "/v1/s3/put-object" && request.method === "POST") {
        uploads.push(String(request.headers["x-api-key"] ?? ""));
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ pin: { cid, name: "uuid-1" } }));
        return;
      }
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      setPrivyJwksUrl(`${url.origin}/jwks`);
      const testApp = makeApp();

      const upload = await testApp.request(
        "/v1/storage?name=uuid-1",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/octet-stream",
          },
          body: new Uint8Array(deliverable),
        },
        bindings(url.origin),
      );
      setPrivyJwksUrl(null);

      expect(upload.status).toBe(201);
      await expect(upload.json()).resolves.toMatchObject({ cid, name: "uuid-1" });
      expect(uploads).toEqual(["test-key"]);
    },
  );
});

test("upload without a name generates one server-side", async () => {
  const { token, jwk } = await makeToken();

  await withServer(
    async (request, response) => {
      if (request.url === "/jwks") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (request.url === "/v1/s3/put-object" && request.method === "POST") {
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ pin: { cid, name: "generated" } }));
        return;
      }
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      setPrivyJwksUrl(`${url.origin}/jwks`);
      const upload = await app.request(
        "/v1/storage",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/octet-stream",
          },
          body: new Uint8Array(deliverable),
        },
        bindings(url.origin),
      );
      setPrivyJwksUrl(null);

      expect(upload.status).toBe(201);
    },
  );
});

test("requests without a token are rejected", async () => {
  const response = await app.request(
    "/v1/storage?name=uuid-1",
    { method: "POST", body: new Uint8Array(deliverable) },
    bindings("http://127.0.0.1:1"),
  );
  expect(response.status).toBe(401);
});

test("an empty body is a 400", async () => {
  const { token, jwk } = await makeToken();

  await withServer(
    async (request, response) => {
      if (request.url === "/jwks") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      setPrivyJwksUrl(`${url.origin}/jwks`);
      const response = await app.request(
        "/v1/storage?name=uuid-1",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
        },
        bindings(url.origin),
      );
      setPrivyJwksUrl(null);

      expect(response.status).toBe(400);
    },
  );
});
