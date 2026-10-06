import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { problemDetails } from "hono-problem-details";
import { problemDetailsResponse } from "hono-problem-details/openapi";
import { z } from "zod";

import { Env } from "../env";
import { requirePrivyUser } from "../lib/privy-auth";
import { uploadStorageOutputSchema } from "../schemas/storage";

// Uploads only: the pin name is a UUID supplied by the CLI, and downloads never
// touch this API — the public gateway serves bytes by CID and clients verify
// the sha2-256 locally, so no resolution or download route exists here.
export const uploadStorageRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    // Any name works; the CLI sends a fresh UUID per upload so pins never
    // collide, even for re-uploads of the same bytes.
    query: z.object({ name: z.string().min(1).optional() }),
  },
  responses: {
    201: {
      description: "Pinned",
      content: { "application/json": { schema: uploadStorageOutputSchema } },
    },
    400: problemDetailsResponse(400),
    401: problemDetailsResponse(401),
    502: problemDetailsResponse(502),
  },
});

const quicknodeUploadSchema = z.object({
  pin: z.object({ cid: z.string().min(1) }),
});

export const storageHandlers = new OpenAPIHono<Env>().openapi(uploadStorageRoute, async (c) => {
  await requirePrivyUser(c);
  const name = c.req.valid("query").name ?? crypto.randomUUID();

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
});
