import { z } from "zod";

/**
 * Provider-agnostic view of a payable data tool. Discovery providers (Monid
 * today, others later) map their catalogs onto these schemas, so callers —
 * the API, the CLI, agents — never see provider shapes.
 */
export const toolPriceSchema = z.object({
  type: z.string().describe("Pricing model, e.g. PER_CALL or PER_RESULT"),
  amount: z.object({
    value: z.number().describe("What one run costs, in USD"),
    currency: z.string(),
  }),
});

/** Pricing models whose cost depends on wall-clock time — x402 cannot prepay them. */
export const UNSUPPORTED_TOOL_PRICE_TYPES = ["METERED", "BY_PERIOD"];

export const toolSchema = z.object({
  provider: z.string().describe("Provider slug"),
  providerName: z.string().nullable().describe("Provider display name"),
  endpoint: z.string().describe("Endpoint path within the provider"),
  description: z.string(),
  score: z.number().describe("Relevance score for the query, in (0, 1)"),
  tags: z.array(z.string()),
  price: toolPriceSchema,
});

export const toolSearchQuerySchema = z.object({
  q: z.string().min(1).describe("What you need, in natural language"),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(40)
    .default(20)
    .describe("Maximum number of tools to return")
    .meta({ example: 20 }),
});
export const toolSearchOutputSchema = z.object({
  query: z.string(),
  tools: z.array(toolSchema),
});

export const toolInspectParamsSchema = z.object({
  provider: z.string().describe("Provider slug"),
  endpoint: z.string().describe("Endpoint path within the provider"),
});

// Providers describe a tool's inputs as one JSON Schema per parameter location;
// unknown locations are dropped rather than reshaped.
const inputLocationSchema = z.record(z.string(), z.unknown()).optional();

export const toolInspectOutputSchema = toolSchema.omit({ score: true }).extend({
  method: z.string().nullable().describe("HTTP method the tool expects"),
  summary: z.string().nullable().describe("Detailed overview"),
  price: toolPriceSchema
    .nullable()
    .describe("Pricing; null when the provider has not published it"),
  input: z
    .object({
      pathParams: inputLocationSchema,
      queryParams: inputLocationSchema,
      body: inputLocationSchema,
      bodyType: z.string().nullable().describe("Body content type: json, form or multipart"),
    })
    .nullable()
    .describe("Structured input — a JSON Schema per parameter location"),
  docUrl: z.string().nullable().describe("Link to provider documentation"),
  notes: z.array(z.string()).nullable().describe("Operator-curated quirks and pitfalls"),
});

export type Tool = z.infer<typeof toolSchema>;
export type ToolPrice = z.infer<typeof toolPriceSchema>;
export type ToolSearchQuery = z.infer<typeof toolSearchQuerySchema>;
export type ToolSearchOutput = z.infer<typeof toolSearchOutputSchema>;
export type ToolInspectParams = z.infer<typeof toolInspectParamsSchema>;
export type ToolInspectOutput = z.infer<typeof toolInspectOutputSchema>;
