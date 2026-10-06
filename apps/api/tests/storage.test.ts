import http from "node:http";
import { expect, test } from "vite-plus/test";
import { PRIVY_APP_ID } from "@spaceobject/core";
import { problemDetailsHandler } from "hono-problem-details";

import app from "../src/index.ts";
import type { WorkerSecrets } from "../src/env.ts";
import { setPrivyJwksUrl, type EcJwk } from "../src/lib/privy-auth.ts";

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
    QUICKNODE_GATEWAY_URL: `${quicknodeUrl}/gateway`,
  };
}

test("upload pins through QuickNode and download resolves the hash back to bytes", async () => {
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
        response.end(JSON.stringify({ pin: { cid, name: sha256 } }));
        return;
      }
      if (request.url === "/v1/pinning?pageNumber=1&perPage=100") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            data: [{ cid, name: sha256, createdAt: "2026-10-05T16:00:00Z" }],
            totalPages: 1,
            totalItems: 1,
          }),
        );
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
      setPrivyJwksUrl(`${url.origin}/jwks`);
      const env = bindings(url.origin);
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
      setPrivyJwksUrl(null);
    },
  );
});

test("download with ?cid= skips pin resolution", async () => {
  const { token, jwk } = await makeToken();

  await withServer(
    async (request, response) => {
      if (request.url === "/jwks") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
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
      setPrivyJwksUrl(`${url.origin}/jwks`);
      const download = await app.request(
        `/v1/storage/${sha256}?cid=${cid}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        bindings(url.origin),
      );
      setPrivyJwksUrl(null);

      expect(download.status).toBe(200);
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array(deliverable));
    },
  );
});

test("requests without a token are rejected", async () => {
  const response = await app.request(`/v1/storage/${sha256}`, {}, bindings("http://127.0.0.1:1"));
  expect(response.status).toBe(401);
});

test("an unknown deliverable hash resolves to 404", async () => {
  const { token, jwk } = await makeToken();

  await withServer(
    async (request, response) => {
      if (request.url === "/jwks") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
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
      setPrivyJwksUrl(`${url.origin}/jwks`);
      const response = await app.request(
        `/v1/storage/${sha256}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        bindings(url.origin),
      );
      setPrivyJwksUrl(null);

      expect(response.status).toBe(404);
    },
  );
});

test("duplicate pin names resolve to the newest pin", async () => {
  const { token, jwk } = await makeToken();
  const oldCid = "bafkreioldpin0000000000000000000000000000000000000000000000";
  const newCid = "bafkreinewpin0000000000000000000000000000000000000000000000";
  const newBytes = Buffer.from("newest ciphertext bytes");

  await withServer(
    async (request, response) => {
      if (request.url === "/jwks") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (request.url === "/v1/pinning?pageNumber=1&perPage=100") {
        // Undocumented list order puts the newest first — the resolver must not
        // rely on it, this pins the opposite order on purpose.
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            data: [
              { cid: oldCid, name: sha256, createdAt: "2026-10-01T00:00:00Z" },
              { cid: newCid, name: sha256, createdAt: "2026-10-06T00:00:00Z" },
            ],
            totalPages: 1,
            totalItems: 2,
          }),
        );
        return;
      }
      if (request.url === `/gateway/ipfs/${newCid}?key=test-key`) {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end(newBytes);
        return;
      }
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      setPrivyJwksUrl(`${url.origin}/jwks`);
      const download = await app.request(
        `/v1/storage/${sha256}`,
        { headers: { Authorization: `Bearer ${token}` } },
        bindings(url.origin),
      );
      setPrivyJwksUrl(null);

      expect(download.status).toBe(200);
      expect(download.headers.get("X-IPFS-Cid")).toBe(newCid);
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array(newBytes));
    },
  );
});

test("a match on a later page resolves after scanning through page one", async () => {
  const { token, jwk } = await makeToken();
  const filler = Array.from({ length: 100 }, (_, index) => ({
    cid: `bafkreifiller${index}`,
    name: `0x${(index + 1).toString(16).padStart(64, "0")}`,
    createdAt: "2026-10-01T00:00:00Z",
  }));

  await withServer(
    async (request, response) => {
      if (request.url === "/jwks") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (request.url === "/v1/pinning?pageNumber=1&perPage=100") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: filler, totalPages: 2, totalItems: 101 }));
        return;
      }
      if (request.url === "/v1/pinning?pageNumber=2&perPage=100") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            data: [{ cid, name: sha256, createdAt: "2026-10-06T00:00:00Z" }],
            totalPages: 2,
            totalItems: 101,
          }),
        );
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
      setPrivyJwksUrl(`${url.origin}/jwks`);
      const download = await app.request(
        `/v1/storage/${sha256}`,
        { headers: { Authorization: `Bearer ${token}` } },
        bindings(url.origin),
      );
      setPrivyJwksUrl(null);

      expect(download.status).toBe(200);
      expect(download.headers.get("X-IPFS-Cid")).toBe(cid);
    },
  );
});

test("totalItems beyond the scanned window reports resolution exceeded, not 404", async () => {
  const { token, jwk } = await makeToken();

  await withServer(
    async (request, response) => {
      if (request.url === "/jwks") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (request.url?.startsWith("/v1/pinning")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            data: [],
            totalPages: 20,
            totalItems: 2000,
          }),
        );
        return;
      }
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      setPrivyJwksUrl(`${url.origin}/jwks`);
      const response = await app.request(
        `/v1/storage/${sha256}`,
        { headers: { Authorization: `Bearer ${token}` } },
        bindings(url.origin),
      );
      setPrivyJwksUrl(null);

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({
        title: "Resolution window exceeded",
      });
    },
  );
});

test("an undated same-name pin is unresolvable rather than first-match", async () => {
  const { token, jwk } = await makeToken();

  await withServer(
    async (request, response) => {
      if (request.url === "/jwks") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (request.url === "/v1/pinning?pageNumber=1&perPage=100") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ data: [{ cid, name: sha256 }], totalPages: 1, totalItems: 1 }),
        );
        return;
      }
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      setPrivyJwksUrl(`${url.origin}/jwks`);
      const response = await app.request(
        `/v1/storage/${sha256}`,
        { headers: { Authorization: `Bearer ${token}` } },
        bindings(url.origin),
      );
      setPrivyJwksUrl(null);

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({ title: "Unresolvable pin" });
    },
  );
});

test("a full-scan miss with a multi-page account returns 404, not window-exceeded", async () => {
  const { token, jwk } = await makeToken();
  // 150 pins over 2 pages, none matching: every pin IS scanned, so this must
  // be a plain 404 — the stale-sentinel bug previously returned a 502 claiming
  // a window was exceeded.
  const filler = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      cid: `bafkreifiller${index}`,
      name: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      createdAt: "2026-10-01T00:00:00Z",
    }));

  await withServer(
    async (request, response) => {
      if (request.url === "/jwks") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (request.url === "/v1/pinning?pageNumber=1&perPage=100") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: filler(100), totalPages: 2, totalItems: 150 }));
        return;
      }
      if (request.url === "/v1/pinning?pageNumber=2&perPage=100") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: filler(50), totalPages: 2, totalItems: 150 }));
        return;
      }
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      setPrivyJwksUrl(`${url.origin}/jwks`);
      const response = await app.request(
        `/v1/storage/${sha256}`,
        { headers: { Authorization: `Bearer ${token}` } },
        bindings(url.origin),
      );
      setPrivyJwksUrl(null);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ title: "Not found" });
    },
  );
});

test("a short page (perPage not honored) with matching totalItems still 404s", async () => {
  const { token, jwk } = await makeToken();
  // The backend returns fewer than perPage on page 1 and totalItems equals the
  // returned count: the scan is complete even though 100 were requested.
  await withServer(
    async (request, response) => {
      if (request.url === "/jwks") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (request.url === "/v1/pinning?pageNumber=1&perPage=100") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            data: [
              {
                cid: "bafkreishortpage00000000000000000000000000000000000000000",
                name: `0x${"11".repeat(32)}`,
                createdAt: "2026-10-01T00:00:00Z",
              },
            ],
            totalPages: 1,
            totalItems: 1,
          }),
        );
        return;
      }
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      setPrivyJwksUrl(`${url.origin}/jwks`);
      const response = await app.request(
        `/v1/storage/${sha256}`,
        { headers: { Authorization: `Bearer ${token}` } },
        bindings(url.origin),
      );
      setPrivyJwksUrl(null);

      expect(response.status).toBe(404);
    },
  );
});

test("a duplicate-name upload surfaces as 409 with pin detail", async () => {
  const { token, jwk } = await makeToken();

  await withServer(
    async (request, response) => {
      if (request.url === "/jwks") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (request.url === "/v1/s3/put-object" && request.method === "POST") {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            statusCode: 400,
            message: "File with that name already exists in your account.",
          }),
        );
        return;
      }
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      setPrivyJwksUrl(`${url.origin}/jwks`);
      const response = await app.request(
        `/v1/storage?name=${sha256}`,
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

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        title: "Already pinned",
        detail: `A deliverable with hash ${sha256} is already pinned; it cannot be re-uploaded.`,
      });
    },
  );
});
