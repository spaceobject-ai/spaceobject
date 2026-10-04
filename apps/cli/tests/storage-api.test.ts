import http from "node:http";
import { expect, test } from "vite-plus/test";
import { downloadDeliverable, uploadDeliverable } from "../src/lib/storage.ts";
import { CliError } from "../src/utils/errors.ts";

// Real local HTTP servers stand in for the Space Object API: the CLI's fetch
// code runs for real, only the remote end is ours.
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

const sha256 = `0x${"cd".repeat(32)}`;
const cid = "bafkreicouv3sksjuzxb3rbb6rziy6duakk2aikegsmtqtz5rsuppjorxsa";

test("uploadDeliverable posts the bytes with the pin name and bearer token", async () => {
  const requests: string[] = [];

  await withServer(
    async (request, response) => {
      requests.push(`${request.method} ${request.url} ${request.headers.authorization ?? ""}`);
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ cid, name: sha256 }));
    },
    async (url) => {
      const result = await uploadDeliverable(
        Buffer.from("deliverable"),
        sha256,
        "token",
        url.origin,
      );

      expect(result).toBe(cid);
      expect(requests[0]).toBe(`POST /v1/storage?name=${sha256} Bearer token`);
    },
  );
});

test("uploadDeliverable requires a token", async () => {
  await expect(
    uploadDeliverable(Buffer.from("x"), sha256, null, "http://127.0.0.1:1"),
  ).rejects.toThrow(CliError);
});

test("downloadDeliverable returns the bytes and the resolved CID header", async () => {
  await withServer(
    (request, response) => {
      if (request.url === `/v1/storage/${sha256}`) {
        response.writeHead(200, {
          "content-type": "application/octet-stream",
          "X-IPFS-Cid": cid,
        });
        response.end("deliverable");
        return;
      }
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      const result = await downloadDeliverable(sha256, undefined, "token", url.origin);

      expect(result.stored.toString()).toBe("deliverable");
      expect(result.cid).toBe(cid);
    },
  );
});

test("downloadDeliverable passes ?cid= to skip resolution", async () => {
  await withServer(
    (request, response) => {
      if (request.url === `/v1/storage/${sha256}?cid=${cid}`) {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end("deliverable");
        return;
      }
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      const result = await downloadDeliverable(sha256, cid, "token", url.origin);

      expect(result.stored.toString()).toBe("deliverable");
    },
  );
});

test("downloadDeliverable maps 404 to STORAGE_NOT_FOUND", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      await expect(downloadDeliverable(sha256, undefined, "token", url.origin)).rejects.toThrow(
        /No deliverable with hash/,
      );
    },
  );
});

test("downloadDeliverable reports an unreachable API", async () => {
  await expect(
    downloadDeliverable(sha256, undefined, "token", "http://127.0.0.1:1"),
  ).rejects.toThrow(/Could not reach the Space Object API/);
});
