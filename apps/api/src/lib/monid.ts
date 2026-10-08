import type {
  Tool,
  ToolInspectOutput,
  ToolInspectParams,
  ToolSearchQuery,
} from "@spaceobject/core";
import { UNSUPPORTED_TOOL_PRICE_TYPES } from "@spaceobject/core";
import { z } from "zod";

// Discovery and inspection are catalog reads: they answer with metadata and
// never execute an endpoint. Running happens from the caller's wallet over the
// x402 rail (https://x402.monid.ai/v1/run), so no run traffic passes here.
const API_URL = "https://api.monid.ai";

/**
 * Monid bills every run at a $0.01 minimum: a cheaper quote is raised to the
 * floor at settlement. Advertised prices are floored here too, so the catalog
 * always shows what a run would actually cost.
 */
const MIN_USD_PRICE = 0.01;

const priceSchema = z.object({
  type: z.string(),
  amount: z.object({ value: z.number(), currency: z.string() }),
});

// The response schemas are exported for tests, which feed fixtures through the
// mapping helpers.
export const searchResponseSchema = z.object({
  results: z
    .array(
      z.object({
        provider: z.string(),
        providerName: z.string().optional(),
        endpoint: z.string(),
        description: z.string(),
        score: z.number(),
        tags: z.array(z.string()).prefault([]),
        price: priceSchema.optional(),
      }),
    )
    .prefault([]),
});

export const inspectResponseSchema = z.object({
  provider: z.string(),
  providerName: z.string().optional(),
  endpoint: z.string(),
  method: z.string().optional(),
  description: z.string(),
  summary: z.string().optional(),
  input: z
    .object({
      pathParams: z.record(z.string(), z.unknown()).optional(),
      queryParams: z.record(z.string(), z.unknown()).optional(),
      body: z.record(z.string(), z.unknown()).optional(),
      bodyType: z.string().optional(),
    })
    .optional(),
  price: priceSchema.optional(),
  docUrl: z.string().optional(),
  notes: z.array(z.string()).optional(),
  tags: z.array(z.string()).prefault([]),
});

/** USD above the Monid floor, so the catalog shows what a run really costs. */
const toUsdPrice = (price: z.infer<typeof priceSchema>) => ({
  type: price.type,
  amount: { ...price.amount, value: Math.max(price.amount.value, MIN_USD_PRICE) },
});

/**
 * Maps a Monid discover response onto the shared tool schemas. Metered and
 * period-billed endpoints are dropped: the x402 rail is a single fixed upfront
 * payment, so they can never be run from here. Exported for tests.
 */
export function toSearchResult(response: z.input<typeof searchResponseSchema>): Tool[] {
  return (response.results ?? []).flatMap((result) => {
    // A result without published pricing cannot be prepaid either.
    if (result.price === undefined || UNSUPPORTED_TOOL_PRICE_TYPES.includes(result.price.type))
      return [];

    return [
      {
        provider: result.provider,
        providerName: result.providerName ?? null,
        endpoint: result.endpoint,
        description: result.description,
        score: result.score,
        tags: result.tags ?? [],
        price: toUsdPrice(result.price),
      },
    ];
  });
}

/** Maps a Monid inspect response onto the shared tool schemas. Exported for tests. */
export function toInspectResult(
  response: z.input<typeof inspectResponseSchema>,
): ToolInspectOutput {
  return {
    provider: response.provider,
    providerName: response.providerName ?? null,
    endpoint: response.endpoint,
    method: response.method ?? null,
    description: response.description,
    summary: response.summary ?? null,
    input: response.input
      ? {
          pathParams: response.input.pathParams,
          queryParams: response.input.queryParams,
          body: response.input.body,
          bodyType: response.input.bodyType ?? null,
        }
      : null,
    price: response.price ? toUsdPrice(response.price) : null,
    docUrl: response.docUrl ?? null,
    notes: response.notes ?? null,
    tags: response.tags ?? [],
  };
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

  // Metered filtering can shrink the page below `limit`; callers re-query
  // rather than refill, so the slice keeps the answer honest.
  return toSearchResult(parsed.data).slice(0, query.limit);
}

/** Reads one Monid endpoint's details and maps them into the shared schemas. */
export async function inspectMonidTool(
  params: ToolInspectParams,
  apiKey: string,
): Promise<ToolInspectOutput> {
  if (!apiKey)
    throw new Error("MONID_API_KEY is not set. Set it with `wrangler secret put MONID_API_KEY`.");

  const parsed = inspectResponseSchema.safeParse(
    await requestMonid(
      "/v1/inspect",
      { provider: params.provider, endpoint: params.endpoint },
      apiKey,
    ),
  );
  if (!parsed.success)
    throw new Error("Monid inspect returned a document this API does not understand.");

  return toInspectResult(parsed.data);
}
