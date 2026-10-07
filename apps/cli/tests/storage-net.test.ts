import http from "node:http";
import { deliverableHashFromCid } from "@spaceobject/core";
import { expect, test } from "vite-plus/test";
import { downloadBytes, uploadBytes } from "../src/lib/storage.ts";
import { CliError } from "../src/utils/errors.ts";

// Real local HTTP servers stand in for the Kubo RPC API and the gateways: the
// CLI's fetch code runs for real, only the remote end is ours.
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

test("uploadBytes posts to /api/v0/add and returns a CIDv0 hash", async () => {
  const requests: string[] = [];

  await withServer(
    async (request, response) => {
      requests.push(`${request.method} ${request.url}`);
      response.writeHead(200, { "content-type": "application/json" });
      // Kubo's default add: CIDv0 dag-pb, the same shape QuickNode pins.
      response.end(
        JSON.stringify({
          Name: "test.txt",
          Hash: "QmNScLLyNHuFTzDbKfxTS9JAggzdYve6FbNfH3xSqYURw7",
          Size: "12",
        }),
      );
    },
    async (url) => {
      const cid = await uploadBytes("test.txt", Buffer.from("deliverable"), url.origin);

      expect(cid).toBe("QmNScLLyNHuFTzDbKfxTS9JAggzdYve6FbNfH3xSqYURw7");
      expect(requests[0]).toContain("/api/v0/add?pin=true&quiet=true");
      expect(requests[0]).not.toContain("cid-version");
    },
  );
});

test("a --api upload CID carries an extractable deliverable digest", async () => {
  // The contract that broke in review: whatever uploadBytes returns must pass
  // through deliverableHashFromCid, because upload extracts the onchain value
  // from it. A CIDv1 response would make every --api upload fail.
  expect(deliverableHashFromCid("QmNScLLyNHuFTzDbKfxTS9JAggzdYve6FbNfH3xSqYURw7")).not.toBeNull();
  expect(deliverableHashFromCid("bafkreiabc")).toBeNull();
});

test("uploadBytes surfaces an unreachable node as STORAGE_UPLOAD_FAILED", async () => {
  await expect(uploadBytes("test.txt", Buffer.from("x"), "http://127.0.0.1:1")).rejects.toThrow(
    CliError,
  );
  await expect(uploadBytes("test.txt", Buffer.from("x"), "http://127.0.0.1:1")).rejects.toThrow(
    /Could not reach the IPFS node/,
  );
});

test("downloadBytes returns the bytes of the first gateway that answers ok", async () => {
  await withServer(
    (request, response) => {
      if (request.url === "/ipfs/bafkreiabc") {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end("deliverable");
        return;
      }
      response.writeHead(404);
      response.end();
    },
    async (url) => {
      const bytes = await downloadBytes("bafkreiabc", url.toString());
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
      await expect(downloadBytes("bafkreiabc", url.toString())).rejects.toThrow(
        /Could not fetch bafkreiabc/,
      );
    },
  );
});
