import type { Tool, ToolSearchQuery } from "@spaceobject/core";
import { z } from "zod";

// Discovery is a catalog read: it answers with metadata and never executes an
// endpoint. Calling happens from the caller's wallet over the x402 rail
// (https://x402.monid.ai/v1/run), so no call traffic passes here.
const API_URL = "https://api.monid.ai";

/**
 * Monid bills every call at a $0.01 minimum: a cheaper quote is raised to the
 * floor at settlement. Advertised prices are floored here too, so the catalog
 * always shows what a call would actually cost.
 */
const MIN_USD_PRICE = 0.01;

const priceSchema = z.object({
  type: z.string(),
  amount: z.object({ value: z.number(), currency: z.string() }),
});

// The response schema is exported for tests, which feed fixtures through the
// mapping helper. Monid fields our domain does not carry (providerName, tags)
// are simply not declared — zod strips what it is not told to keep.
export const searchResponseSchema = z.object({
  results: z
    .array(
      z.object({
        provider: z.string(),
        endpoint: z.string(),
        description: z.string(),
        score: z.number(),
        input: z
          .object({
            pathParams: z.record(z.string(), z.unknown()).optional(),
            queryParams: z.record(z.string(), z.unknown()).optional(),
            body: z.record(z.string(), z.unknown()).optional(),
            bodyType: z.string().optional(),
          })
          .optional(),
        price: priceSchema.optional(),
      }),
    )
    .prefault([]),
});

/**
 * Maps a Monid discover response onto the shared tool schemas. Only per-call
 * endpoints are kept: their price settles upfront and the result returns in
 * the same request, which is the sole billing the x402 rail can prepay.
 * Exported for tests.
 */
export function toSearchResult(response: z.input<typeof searchResponseSchema>): Tool[] {
  return (response.results ?? []).flatMap((result) => {
    // An endpoint without published pricing cannot be prepaid either.
    if (result.price?.type !== "PER_CALL") return [];

    return [
      {
        id: `${result.provider}${result.endpoint}`,
        description: result.description,
        score: result.score,
        // Priced at Monid's $0.01 minimum, so the catalog shows the real cost.
        price: Math.max(result.price.amount.value, MIN_USD_PRICE),
        input: result.input
          ? {
              pathParams: result.input.pathParams,
              queryParams: result.input.queryParams,
              body: result.input.body,
              bodyType: result.input.bodyType ?? null,
            }
          : null,
      },
    ];
  });
}

async function requestMonid(path: string, body: unknown, apiKey: string) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`Monid ${path} answered ${response.status} ${response.statusText}.`);

  return response.json().catch(() => null);
}

/**
 * Searches Monid's catalog and maps the answer into the shared tool schemas.
 * The API key is the caller's Worker secret binding (`MONID_API_KEY`).
 */
export async function searchMonidTools(query: ToolSearchQuery, apiKey: string): Promise<Tool[]> {
  if (!apiKey)
    throw new Error("MONID_API_KEY is not set. Set it with `wrangler secret put MONID_API_KEY`.");

  const parsed = searchResponseSchema.safeParse(
    await requestMonid("/v1/discover", { query: query.q, limit: query.limit }, apiKey),
  );
  // A bad document sinks the whole search: results would be silently partial.
  if (!parsed.success)
    throw new Error("Monid discover returned a document this API does not understand.");

  // Per-call filtering can shrink the page below `limit`; callers re-query
  // rather than refill, so the slice keeps the answer honest.
  return toSearchResult(parsed.data).slice(0, query.limit);
}
