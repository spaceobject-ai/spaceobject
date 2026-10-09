import http from "node:http";
import { expect, test } from "vite-plus/test";
import type { z } from "zod";
import { searchMonidTools, searchResponseSchema, toSearchResult } from "../src/lib/monid.ts";

// Real local HTTP servers stand in for Monid: the adapter's fetch code runs
// for real — bearer header, status codes, body decoding — only the remote
// end is ours.
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

// The shape the live API answers with: a nested price amount, a relevance
// score, and an input sketch — none of which the published docs mention.
// Optional fields are omitted the way the live API does for endpoints it
// knows less about.
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

// The shape the published docs describe (https://docs.monid.ai/api/discover):
// a flat price amount with a sibling currency, and no score or input.
const documentedResponse = {
  results: [
    {
      provider: "apify",
      endpoint: "/apidojo/tweet-scraper",
      description: "Scrape tweets by search terms, hashtags, or user handles",
      price: { type: "PER_CALL", amount: 0.003, currency: "USD" },
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

test("the documented shape — flat amount, no score or input — parses too", () => {
  const tools = toSearchResult(documentedResponse);

  expect(tools[0]).toEqual({
    id: "apify/apidojo/tweet-scraper",
    description: "Scrape tweets by search terms, hashtags, or user handles",
    score: 0,
    price: 0.01,
    input: null,
  });
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

test("search posts the query with a bearer token, the limit clamped to Monid's max", async () => {
  const bodies: unknown[] = [];

  await withServer(
    async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);

      expect(request.headers.authorization).toBe("Bearer key");
      bodies.push(JSON.parse(chunks.map(String).join("")));

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(discoverResponse));
    },
    async (url) => {
      // Monid caps its page at 20, so a larger ask is clamped on the wire…
      await searchMonidTools({ q: "scrape", limit: 40 }, "key", url.origin);
      // …while the caller's own limit still bounds the returned list.
      const tools = await searchMonidTools({ q: "scrape", limit: 1 }, "key", url.origin);
      expect(tools).toHaveLength(1);
      expect(tools[0]?.id).toBe("apify/apidojo/tweet-scraper");
    },
  );

  expect(bodies).toEqual([
    { query: "scrape", limit: 20 },
    { query: "scrape", limit: 1 },
  ]);
});

test("a non-OK Monid answer fails with the status named", async () => {
  await withServer(
    (request, response) => {
      response.writeHead(401);
      response.end();
    },
    (url) =>
      expect(searchMonidTools({ q: "scrape", limit: 1 }, "key", url.origin)).rejects.toThrow("401"),
  );
});

test("a body the schema cannot read sinks the whole search", async () => {
  await withServer(
    (request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("not json");
    },
    (url) =>
      expect(searchMonidTools({ q: "scrape", limit: 1 }, "key", url.origin)).rejects.toThrow(
        "does not understand",
      ),
  );
});
