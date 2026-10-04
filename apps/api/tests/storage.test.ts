import http from "node:http";
import { expect, test } from "vite-plus/test";
import { problemDetailsHandler } from "hono-problem-details";

import app from "../src/index.ts";
import type { WorkerSecrets } from "../src/env.ts";

// Real local HTTP servers stand in for Privy's JWKS endpoint and QuickNode's
// API/gateway: the Worker's fetch code runs for real, only the remotes are ours.
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

const sha256 = `0x${"ab".repeat(32)}`;
const cid = "bafkreicouv3sksjuzxb3rbb6rziy6duakk2aikegsmtqtz5rsuppjorxsa";
const deliverable = Buffer.from("test deliverable");

async function makeToken() {
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
  const jwks = { keys: [{ kid: "test-key", kty: "RSA", n: jwk.n ?? "", e: jwk.e ?? "AQAB" }] };

  const header = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "test-key" })),
  );
  const payload = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({ sub: "user-1", exp: Math.floor(Date.now() / 1000) + 60, iss: "privy.io" }),
    ),
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );

  return { token: `${header}.${payload}.${toBase64Url(new Uint8Array(signature))}`, jwks };
}

// The app mounts the problem-details error handler; a bare handler export would
// turn thrown problemDetails into 500s, so the test targets the real app.
function makeApp() {
  const testApp = app;
  testApp.onError(problemDetailsHandler({ autoInstance: true }));
  return testApp;
}

type Bindings = CloudflareBindings & WorkerSecrets;

function bindings(jwksUrl: string, quicknodeUrl: string): Bindings {
  return {
    ERC_8004_SUBGRAPH_URL: "",
    ERC_8004_SUBGRAPH_API_KEY: "",
    ERC_8183_SUBGRAPH_URL: "",
    ERC_8183_SUBGRAPH_API_KEY: "",
    QUICKNODE_IPFS_API_URL: quicknodeUrl,
    QUICKNODE_IPFS_API_KEY: "test-key",
    QUICKNODE_GATEWAY_URL: `${quicknodeUrl}/gateway`,
    PRIVY_JWKS_URL: jwksUrl,
  } as Bindings;
}

test("upload pins through QuickNode and download resolves the hash back to bytes", async () => {
  const { token, jwks } = await makeToken();
  const uploads: string[] = [];

  await withServer(
    async (request, response) => {
      if (request.url === "/jwks") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(jwks));
        return;
      }
      if (request.method === "POST" && request.url === "/v1/s3/put-object") {
        uploads.push(String(request.headers["x-api-key"] ?? ""));
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ pin: { cid, name: sha256 } }));
        return;
      }
      if (request.url === "/v1/pinning?pageNumber=1&perPage=100") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ cid, name: sha256 }], totalPages: 1 }));
        return;
      }
      if (request.url === `/gateway/ipfs/${cid}?key=test-key`) {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end(deliverable);
        return;
      }
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      const env = bindings(`${url.origin}/jwks`, url.origin);
      const testApp = makeApp();

      const upload = await testApp.request(
        `/v1/storage?name=${sha256}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
          body: new Uint8Array(deliverable),
        },
        env,
      );
      expect(upload.status).toBe(201);
      await expect(upload.json()).resolves.toMatchObject({ cid });
      expect(uploads).toEqual(["test-key"]);

      const download = await testApp.request(
        `/v1/storage/${sha256}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        env,
      );
      expect(download.status).toBe(200);
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array(deliverable));
      expect(download.headers.get("X-IPFS-Cid")).toBe(cid);
    },
  );
});

test("download with ?cid= skips pin resolution", async () => {
  const { token, jwks } = await makeToken();

  await withServer(
    async (request, response) => {
      if (request.url === "/jwks") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(jwks));
        return;
      }
      if (request.url === `/gateway/ipfs/${cid}?key=test-key`) {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end(deliverable);
        return;
      }
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      const env = bindings(`${url.origin}/jwks`, url.origin);

      const download = await app.request(
        `/v1/storage/${sha256}?cid=${cid}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        env,
      );
      expect(download.status).toBe(200);
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array(deliverable));
    },
  );
});

test("requests without a token are rejected", async () => {
  const response = await app.request(
    `/v1/storage/${sha256}`,
    {},
    bindings("http://127.0.0.1:1", "http://127.0.0.1:1"),
  );
  expect(response.status).toBe(401);
});

test("an unknown deliverable hash resolves to 404", async () => {
  const { token, jwks } = await makeToken();

  await withServer(
    async (request, response) => {
      if (request.url === "/jwks") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(jwks));
        return;
      }
      if (request.url === "/v1/pinning?pageNumber=1&perPage=100") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [], totalPages: 1 }));
        return;
      }
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      const response = await app.request(
        `/v1/storage/${sha256}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        bindings(`${url.origin}/jwks`, url.origin),
      );

      expect(response.status).toBe(404);
    },
  );
});
