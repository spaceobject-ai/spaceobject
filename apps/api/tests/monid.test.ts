import { expect, test, vi } from "vite-plus/test";
import type { z } from "zod";
import { searchMonidTools, searchResponseSchema, toSearchResult } from "../src/lib/monid.ts";

// The shapes Monid answers with; optional fields are omitted the way the live
// API does for endpoints it knows less about.
const discoverResponse: z.input<typeof searchResponseSchema> = {
  results: [
    {
      provider: "apify",
      endpoint: "/apidojo/tweet-scraper",
      description: "Scrape tweets by search terms, hashtags, or user handles",
      score: 0.87,
      input: {
        body: { type: "object", properties: { searchTerms: { type: "array" } } },
        bodyType: "json",
      },
      price: { type: "PER_CALL", amount: { value: 0.03, currency: "USD" } },
    },
    {
      provider: "browser-use",
      endpoint: "/scrape",
      description: "Bill by wall-clock minute, which x402 cannot prepay",
      score: 0.5,
      price: { type: "METERED", amount: { value: 0.002, currency: "USD" } },
    },
    {
      provider: "rows",
      endpoint: "/resolve",
      description: "Bill per result row, so the answer is not in the same request",
      score: 0.6,
      price: { type: "PER_RESULT", amount: { value: 0.01, currency: "USD" } },
    },
    {
      provider: "nomad",
      endpoint: "/listings",
      description: "No published pricing, so nothing to prepay",
      score: 0.4,
    },
    {
      provider: "pdl",
      endpoint: "/person/enrich",
      description: "Enrich a person by email",
      score: 0.9,
      price: { type: "PER_CALL", amount: { value: 0.001, currency: "USD" } },
    },
  ],
};

test("endpoints map to one tool each, id joining provider and endpoint", () => {
  const tools = toSearchResult(discoverResponse);

  expect(tools[0]).toEqual({
    id: "apify/apidojo/tweet-scraper",
    description: "Scrape tweets by search terms, hashtags, or user handles",
    score: 0.87,
    price: 0.03,
    input: {
      pathParams: undefined,
      queryParams: undefined,
      body: { type: "object", properties: { searchTerms: { type: "array" } } },
      bodyType: "json",
    },
  });
  expect(tools).toHaveLength(2);
});

test("only per-call endpoints are listed — the result must ride the paying request", () => {
  const ids = toSearchResult(discoverResponse).map((tool) => tool.id);

  expect(ids).toEqual(["apify/apidojo/tweet-scraper", "pdl/person/enrich"]);
});

test("prices under Monid's $0.01 minimum are shown at the floor", () => {
  const pdl = toSearchResult(discoverResponse).find((tool) => tool.id.startsWith("pdl"));

  expect(pdl?.price).toBe(0.01);
});

test("input falls back to null when Monid omits it", () => {
  const pdl = toSearchResult(discoverResponse).find((tool) => tool.id.startsWith("pdl"));

  expect(pdl?.input).toBeNull();
});

test("the flat tool list respects the query's limit", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(discoverResponse), { status: 200 })),
  );
  try {
    const tools = await searchMonidTools({ q: "scrape", limit: 1 }, "key");
    expect(tools).toHaveLength(1);
    expect(tools[0]?.id).toBe("apify/apidojo/tweet-scraper");
  } finally {
    vi.unstubAllGlobals();
  }
});
