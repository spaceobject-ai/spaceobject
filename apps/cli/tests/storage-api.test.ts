import http from "node:http";
import { expect, test } from "vite-plus/test";
import { downloadBytes, uploadDeliverable } from "../src/lib/storage.ts";
import { CliError } from "../src/utils/errors.ts";

// Real local HTTP servers stand in for the Space Object API and the gateways:
// the CLI's fetch code runs for real, only the remote end is ours.
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

const cid = "bafkreicouv3sksjuzxb3rbb6rziy6duakk2aikegsmtqtz5rsuppjorxsa";

test("uploadDeliverable posts the bytes with a bearer token and returns the CID", async () => {
  const requests: string[] = [];

  await withServer(
    async (request, response) => {
      requests.push(`${request.method} ${request.url} ${request.headers.authorization ?? ""}`);
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ cid, name: "uuid-1" }));
    },
    async (url) => {
      const result = await uploadDeliverable(Buffer.from("deliverable"), "token", url.origin);

      expect(result).toBe(cid);
      expect(requests[0]).toMatch(/^POST \/v1\/storage\?name=[0-9a-f-]{36} Bearer token$/);
    },
  );
});

test("uploadDeliverable requires a token", async () => {
  await expect(uploadDeliverable(Buffer.from("x"), null, "http://127.0.0.1:1")).rejects.toThrow(
    CliError,
  );
});

test("downloadBytes returns the first gateway that answers ok", async () => {
  await withServer(
    (request, response) => {
      if (request.url === `/ipfs/${cid}`) {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end("deliverable");
        return;
      }
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      const bytes = await downloadBytes(cid, url.origin);
      expect(bytes.toString()).toBe("deliverable");
    },
  );
});

test("downloadBytes fails with STORAGE_DOWNLOAD_FAILED when no gateway answers", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(500);
      response.end();
    },
    async (url) => {
      await expect(downloadBytes(cid, url.origin)).rejects.toThrow(/Could not fetch bafkrei/);
    },
  );
});
