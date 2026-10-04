import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { problemDetails } from "hono-problem-details";
import { problemDetailsResponse } from "hono-problem-details/openapi";
import { z } from "zod";

import { Env } from "../env";
import { requirePrivyUser } from "../lib/privy-auth";
import {
  downloadStorageParamsSchema,
  downloadStorageQuerySchema,
  uploadStorageOutputSchema,
  uploadStorageQuerySchema,
} from "../schemas/storage";

export const uploadStorageRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    query: uploadStorageQuerySchema,
  },
  responses: {
    201: {
      description: "Pinned",
      content: { "application/json": { schema: uploadStorageOutputSchema } },
    },
    401: problemDetailsResponse(401),
    502: problemDetailsResponse(502),
  },
});

export const downloadStorageRoute = createRoute({
  method: "get",
  path: "/{sha256}",
  request: {
    params: downloadStorageParamsSchema,
    query: downloadStorageQuerySchema,
  },
  responses: {
    200: {
      description: "Deliverable bytes",
      content: { "application/octet-stream": { schema: z.string() } },
    },
    401: problemDetailsResponse(401),
    404: problemDetailsResponse(404),
    502: problemDetailsResponse(502),
  },
});

const quicknodeUploadSchema = z.object({
  pin: z.object({ cid: z.string().min(1) }),
});

const pinsSchema = z.object({
  data: z.array(z.object({ cid: z.string().min(1), name: z.string() })),
  totalPages: z.coerce.number().optional(),
});

// QuickNode is the only database: pins are stored under the deliverable hash as
// their name, so a stateless download resolves a hash back to its CID by
// listing pins. The page cap bounds a hostile pin count; a miss is a 404.
const RESOLVE_PAGE_LIMIT = 10;

export const storageHandlers = new OpenAPIHono<Env>()
  .openapi(uploadStorageRoute, async (c) => {
    await requirePrivyUser(c);
    const name = c.req.valid("query").name;

    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength === 0)
      throw problemDetails({
        status: 400,
        title: "Bad request",
        detail: "The request body is empty.",
        type: "Storage",
      });

    const form = new FormData();
    form.append("Body", new Blob([bytes]), name);
    form.append("Key", name);
    form.append("ContentType", "application/octet-stream");

    const response = await fetch(
      `${c.env.QUICKNODE_IPFS_API_URL.replace(/\/+$/, "")}/v1/s3/put-object`,
      { method: "POST", headers: { "x-api-key": c.env.QUICKNODE_IPFS_API_KEY }, body: form },
    ).catch(() => null);
    if (response === null || !response.ok)
      throw problemDetails({
        status: 502,
        title: "Bad gateway",
        detail: "QuickNode rejected the upload.",
        type: "Storage",
      });

    const result = quicknodeUploadSchema.safeParse(await response.json().catch(() => null));
    if (!result.success)
      throw problemDetails({
        status: 502,
        title: "Bad gateway",
        detail: "QuickNode returned an unreadable upload response.",
        type: "Storage",
      });

    return c.json({ cid: result.data.pin.cid, name }, 201);
  })
  .openapi(downloadStorageRoute, async (c) => {
    await requirePrivyUser(c);
    const sha256 = c.req.valid("param").sha256;
    const cid = c.req.valid("query").cid ?? (await resolveCid(c.env, sha256));

    // The gateway secret may hold the full key-embedded form; strip any /ipfs
    // suffix so only the base domain is used, then send the key as both a query
    // param and a header to cover either private-gateway convention.
    const base = c.env.QUICKNODE_GATEWAY_URL.replace(/\/+$/, "").replace(/\/ipfs$/, "");
    const response = await fetch(`${base}/ipfs/${cid}?key=${c.env.QUICKNODE_IPFS_API_KEY}`, {
      headers: { "x-api-key": c.env.QUICKNODE_IPFS_API_KEY },
    }).catch(() => null);
    if (response === null || !response.ok)
      throw problemDetails({
        status: 502,
        title: "Bad gateway",
        detail: `Could not fetch ${cid} from the IPFS gateway.`,
        type: "Storage",
      });

    return c.body(await response.arrayBuffer(), 200, {
      "Content-Type": response.headers.get("Content-Type") ?? "application/octet-stream",
      "X-IPFS-Cid": cid,
    });
  });

async function resolveCid(env: Env["Bindings"], sha256: string): Promise<string> {
  for (let page = 1; page <= RESOLVE_PAGE_LIMIT; page += 1) {
    const pins = await fetch(
      `${env.QUICKNODE_IPFS_API_URL.replace(/\/+$/, "")}/v1/pinning?pageNumber=${page}&perPage=100`,
      { headers: { "x-api-key": env.QUICKNODE_IPFS_API_KEY } },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => pinsSchema.safeParse(value))
      .catch(() => ({ success: false as const }));

    if (!pins.success)
      throw problemDetails({
        status: 502,
        title: "Bad gateway",
        detail: "Could not list QuickNode pins.",
        type: "Storage",
      });

    const found = pins.data.data.find((pin) => pin.name === sha256);
    if (found) return found.cid;
    if (page >= (pins.data.totalPages ?? page)) break;
  }

  throw problemDetails({
    status: 404,
    title: "Not found",
    detail: `No deliverable pinned with hash ${sha256}.`,
    type: "Storage",
  });
}
