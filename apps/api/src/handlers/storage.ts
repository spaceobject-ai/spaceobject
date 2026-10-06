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
    400: problemDetailsResponse(400),
    401: problemDetailsResponse(401),
    409: problemDetailsResponse(409),
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
  data: z.array(
    z.object({
      cid: z.string().min(1),
      name: z.string(),
      // Present on list responses; older pins may lack it.
      createdAt: z.string().optional(),
    }),
  ),
  totalPages: z.coerce.number().optional(),
  totalItems: z.coerce.number().optional(),
});

// QuickNode is the only database: pins are stored under the deliverable hash as
// their name, so a stateless download resolves a hash back to its CID by
// listing pins. The page cap bounds a hostile pin count; exhausting it is
// reported as a distinct error so "not pinned" stays trustworthy.
const RESOLVE_PAGE_LIMIT = 10;
const RESOLVE_PAGE_SIZE = 100;

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
    if (response === null || !response.ok) {
      // QuickNode rejects duplicate pin names (verified live 2026-10-06: a
      // same-name different-bytes upload returns 400 "File with that name
      // already exists in your account"), so an existing pin under this hash
      // surfaces as 409 — the hash is already pinned and cannot be re-uploaded.
      const duplicate =
        response !== null &&
        response.status === 400 &&
        (
          await response
            .json()
            .then((value) => JSON.stringify(value))
            .catch(() => "")
        ).includes("already exists");

      throw problemDetails({
        status: duplicate ? 409 : 502,
        title: duplicate ? "Already pinned" : "Bad gateway",
        detail: duplicate
          ? `A deliverable with hash ${name} is already pinned; it cannot be re-uploaded.`
          : "QuickNode rejected the upload.",
        type: "Storage",
      });
    }

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

    // The gateway secret may hold the full key-embedded form — a base domain
    // with an /ipfs path and possibly a CID-like key segment after it — so
    // everything from the first /ipfs on is dropped and only the base domain is
    // used. The key is sent as both a query param and a header to cover either
    // private-gateway convention.
    const base = c.env.QUICKNODE_GATEWAY_URL.replace(/\/+$/, "").split("/ipfs")[0];
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

// QuickNode rejects duplicate pin names (verified live 2026-10-06: fresh-name
// upload → 201, same-name different-bytes upload → 400 "File with that name
// already exists in your account"), so duplicate same-name pins cannot occur
// through this API. The newest-wins selection below is defensive: if the
// backend contract ever changes to append semantics, resolution stays
// deterministic instead of trusting undocumented list order.
//
// createdAt values are uniform ISO-8601 UTC timestamps (observed:
// "2026-10-06T07:58:21.384Z"), so the string comparison below sorts them
// correctly; mixed formats would break it, and undated pins fail closed.
async function resolveCid(env: Env["Bindings"], sha256: string): Promise<string> {
  let newest: { cid: string; createdAt: string } | null = null;
  let sawUndated = false;
  let unscanned: number | null = null;
  let scanned = 0;

  for (let page = 1; page <= RESOLVE_PAGE_LIMIT; page += 1) {
    const pins = await fetch(
      `${env.QUICKNODE_IPFS_API_URL.replace(/\/+$/, "")}/v1/pinning?pageNumber=${page}&perPage=${RESOLVE_PAGE_SIZE}`,
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

    for (const pin of pins.data.data) {
      if (pin.name !== sha256) continue;
      if (pin.createdAt === undefined) {
        sawUndated = true;
        continue;
      }
      if (newest === null || pin.createdAt > newest.createdAt)
        newest = { cid: pin.cid, createdAt: pin.createdAt };
    }

    scanned += pins.data.data.length;
    const totalPages = pins.data.totalPages ?? page;
    // Pins remain unscanned only when totalItems exceeds what has actually
    // been returned (perPage is not documented as honored, so pages are
    // counted, not assumed). Reset on every page so a full scan ends null.
    unscanned =
      pins.data.totalItems !== undefined && pins.data.totalItems > scanned
        ? pins.data.totalItems - scanned
        : null;
    if (page >= totalPages) break;
  }

  if (newest !== null) return newest.cid;
  if (sawUndated)
    throw problemDetails({
      status: 502,
      title: "Unresolvable pin",
      detail: `Pin(s) named ${sha256} exist without timestamps, so the latest cannot be selected.`,
      type: "Storage",
    });
  if (unscanned !== null)
    throw problemDetails({
      status: 502,
      title: "Resolution window exceeded",
      detail: `No pin named ${sha256} within the most recent ${scanned} of ${scanned + unscanned} pins.`,
      type: "Storage",
    });

  throw problemDetails({
    status: 404,
    title: "Not found",
    detail: `No deliverable pinned with hash ${sha256}.`,
    type: "Storage",
  });
}
