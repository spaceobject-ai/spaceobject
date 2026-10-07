import http from "node:http";
import { expect, test } from "vite-plus/test";
import { PRIVY_APP_ID } from "@spaceobject/core";

import app from "../src/index.ts";

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

  // The privy client builds its JWKS URL from PRIVY_API_BASE_URL when
  // constructed — per request — so repointing the env var is enough to fake Privy.
  process.env.PRIVY_API_BASE_URL = `http://127.0.0.1:${address.port}`;
  try {
    return await run(new URL(`http://127.0.0.1:${address.port}`));
  } finally {
    delete process.env.PRIVY_API_BASE_URL;
    server.closeIdleConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

type EcPublicJwk = { kty: string; crv: string; x: string; y: string; kid: string; alg: string };

// Privy pins ES256, the "privy.io" issuer and the app id as audience, and the
// client asserts iat, exp, sub and sid are present in the payload.
async function makeToken(): Promise<{ token: string; jwk: EcPublicJwk }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  if (!("publicKey" in pair)) throw new Error("expected a key pair");

  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  if (exported.x === undefined || exported.y === undefined) throw new Error("expected an EC jwk");

  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "test-key" })),
  );
  const payload = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        sub: "user-1",
        sid: "session-1",
        iat: now,
        exp: now + 60,
        iss: "privy.io",
        aud: PRIVY_APP_ID,
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );

  return {
    token: `${header}.${payload}.${toBase64Url(new Uint8Array(signature))}`,
    jwk: { kty: "EC", crv: "P-256", x: exported.x, y: exported.y, kid: "test-key", alg: "ES256" },
  };
}

// The generated CloudflareBindings types carry literal URL types from
// wrangler.jsonc; tests need the handler-shaped env instead.
type Bindings = { [K in keyof CloudflareBindings]: string };

function bindings(quicknodeUrl: string): Bindings {
  return {
    ERC_8004_SUBGRAPH_URL: "",
    ERC_8183_SUBGRAPH_URL: "",
    QUICKNODE_IPFS_API_URL: quicknodeUrl,
    QUICKNODE_IPFS_API_KEY: "test-key",
    PRIVY_APP_SECRET: "test-secret",
  };
}

const cid = "QmNScLLyNHuFTzDbKfxTS9JAggzdYve6FbNfH3xSqYURw7";
const deliverable = new Uint8Array([1, 2, 3, 4]);

// One server plays both Privy (at the JWKS path the client derives from
// PRIVY_API_BASE_URL) and QuickNode; quicknode decides what put-object answers.
async function withStorageRemote<T>(
  jwk: EcPublicJwk,
  quicknode: (request: http.IncomingMessage, response: http.ServerResponse) => void,
  run: (url: URL) => Promise<T>,
): Promise<T> {
  return withServer((request, response) => {
    if (request.url === `/v1/apps/${PRIVY_APP_ID}/jwks.json`) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (request.url === "/v1/s3/put-object") {
      quicknode(request, response);
      return;
    }
    response.writeHead(404);
    response.end();
  }, run);
}

test("upload pins through QuickNode and returns the CID", async () => {
  const { token, jwk } = await makeToken();
  const apiKeys: string[] = [];

  await withStorageRemote(
    jwk,
    (request, response) => {
      apiKeys.push(String(request.headers["x-api-key"] ?? ""));
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ pin: { cid, name: "server-uuid" } }));
    },
    async (url) => {
      const upload = await app.request(
        "/v1/storage",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
          body: deliverable,
        },
        bindings(url.origin),
      );

      expect(upload.status).toBe(201);
      const body = (await upload.json()) as { cid: string; name: string };
      expect(body.cid).toBe(cid);
      // The pin name is server-generated: a UUIDv7, not whatever QuickNode echoed.
      expect(body.name).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(apiKeys).toEqual(["test-key"]);
    },
  );
});

test("requests without a token are rejected", async () => {
  const response = await app.request(
    "/v1/storage",
    { method: "POST", body: deliverable },
    bindings("http://127.0.0.1:1"),
  );

  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ title: "Unauthorized" });
});

test("a token that fails verification is rejected", async () => {
  const { token, jwk } = await makeToken();
  const [header, payload, signature] = token.split(".");
  // Keep the signature decodable but wrong.
  const forged = `${header}.${payload}.${signature.slice(0, -4)}cafe`;

  await withStorageRemote(
    jwk,
    () => {
      throw new Error("QuickNode must not be reached");
    },
    async (url) => {
      const response = await app.request(
        "/v1/storage",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${forged}`,
            "Content-Type": "application/octet-stream",
          },
          body: deliverable,
        },
        bindings(url.origin),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ title: "Unauthorized" });
    },
  );
});

test("an empty body is a 400", async () => {
  const { token, jwk } = await makeToken();

  await withStorageRemote(
    jwk,
    () => {
      throw new Error("QuickNode must not be reached");
    },
    async (url) => {
      const response = await app.request(
        "/v1/storage",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
        },
        bindings(url.origin),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ title: "Bad request" });
    },
  );
});

test("a QuickNode rejection surfaces as a 502", async () => {
  const { token, jwk } = await makeToken();

  await withStorageRemote(
    jwk,
    (request, response) => {
      response.writeHead(500);
      response.end();
    },
    async (url) => {
      const response = await app.request(
        "/v1/storage",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
          body: deliverable,
        },
        bindings(url.origin),
      );

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({ title: "Bad gateway" });
    },
  );
});

test("an unreadable QuickNode response surfaces as a 502", async () => {
  const { token, jwk } = await makeToken();

  await withStorageRemote(
    jwk,
    (request, response) => {
      response.writeHead(201, { "content-type": "application/json" });
      response.end("not json");
    },
    async (url) => {
      const response = await app.request(
        "/v1/storage",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
          body: deliverable,
        },
        bindings(url.origin),
      );

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({ title: "Bad gateway" });
    },
  );
});
