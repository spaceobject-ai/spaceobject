import { expect, test, vi } from "vite-plus/test";
import type { z } from "zod";
import {
  inspectMonidTool,
  inspectResponseSchema,
  searchMonidTools,
  searchResponseSchema,
  toInspectResult,
  toSearchResult,
} from "../src/lib/monid.ts";

// The shapes Monid answers with; optional fields are omitted the way the live
// API does for endpoints it knows less about.
const discoverResponse: z.input<typeof searchResponseSchema> = {
  results: [
    {
      provider: "apify",
      providerName: "Apify",
      endpoint: "/apidojo/tweet-scraper",
      description: "Scrape tweets by search terms, hashtags, or user handles",
      score: 0.87,
      tags: ["twitter", "social-media"],
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

test("endpoints map to one tool each with their advertised price", () => {
  const tools = toSearchResult(discoverResponse);

  expect(tools[0]).toEqual({
    provider: "apify",
    providerName: "Apify",
    endpoint: "/apidojo/tweet-scraper",
    description: "Scrape tweets by search terms, hashtags, or user handles",
    score: 0.87,
    tags: ["twitter", "social-media"],
    price: { type: "PER_CALL", amount: { value: 0.03, currency: "USD" } },
  });
  expect(tools).toHaveLength(2);
});

test("metered endpoints are dropped — x402 is a single fixed upfront payment", () => {
  const types = toSearchResult(discoverResponse).map((tool) => tool.price.type);

  expect(types).not.toContain("METERED");
});

test("prices under Monid's $0.01 minimum are shown at the floor", () => {
  const pdl = toSearchResult(discoverResponse).find((tool) => tool.provider === "pdl");

  expect(pdl?.price.amount.value).toBe(0.01);
});

test("the flat tool list respects the query's limit", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(discoverResponse), { status: 200 })),
  );
  try {
    const tools = await searchMonidTools({ q: "scrape", limit: 1 }, "key");
    expect(tools).toHaveLength(1);
    expect(tools[0]?.endpoint).toBe("/apidojo/tweet-scraper");
  } finally {
    vi.unstubAllGlobals();
  }
});

const inspectResponse: z.input<typeof inspectResponseSchema> = {
  provider: "apify",
  providerName: "Apify",
  endpoint: "/apidojo/tweet-scraper",
  method: "POST",
  description: "Scrape tweets by search terms, hashtags, or user handles",
  summary: "A powerful Twitter scraping tool.",
  input: {
    body: { type: "object", properties: { searchTerms: { type: "array" } } },
    bodyType: "json",
  },
  price: { type: "PER_CALL", amount: { value: 0.05, currency: "USD" } },
  docUrl: "https://apify.com/apidojo/tweet-scraper",
  tags: ["verified"],
};

test("inspect keeps the input schema and the advertised price", () => {
  const detail = toInspectResult(inspectResponse);

  expect(detail.input).toEqual({
    pathParams: undefined,
    queryParams: undefined,
    body: { type: "object", properties: { searchTerms: { type: "array" } } },
    bodyType: "json",
  });
  expect(detail.price?.amount.value).toBe(0.05);
  expect(detail.method).toBe("POST");
});

test("fields Monid omits fall back to the schema's nulls", () => {
  const detail = toInspectResult({ ...inspectResponse, method: undefined, price: undefined });

  expect(detail.method).toBeNull();
  expect(detail.price).toBeNull();
});

test("inspect fails loudly when the key is missing", async () => {
  await expect(inspectMonidTool({ provider: "apify", endpoint: "/x" }, "")).rejects.toThrow(
    "MONID_API_KEY",
  );
});
