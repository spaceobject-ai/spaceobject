import { z } from "zod";

/**
 * Provider-agnostic view of a payable data tool. Discovery providers (Monid
 * today, others later) map their catalogs onto these schemas, so callers —
 * the API, the CLI, agents — never see provider shapes.
 */
// Per-call, in USD: the catalog only lists tools whose price settles once,
// upfront, with the result in the same request, and everything bills in USD.
export const toolPriceSchema = z
  .number()
  .describe("What one call costs, in USD")
  .meta({ example: 0.03 });

// A tool's inputs are described as one JSON Schema per parameter location;
// locations the provider does not declare are dropped rather than reshaped.
const inputLocationSchema = z.record(z.string(), z.unknown()).optional();

export const toolInputSchema = z
  .object({
    pathParams: inputLocationSchema,
    queryParams: inputLocationSchema,
    body: inputLocationSchema,
    bodyType: z.string().nullable().describe("Body content type: json, form or multipart"),
  })
  .nullable()
  .describe("Structured input — a JSON Schema per parameter location");

export const toolSchema = z.object({
  id: z.string().describe("Tool id, `${provider}${endpoint}` — the handle `tool call` takes"),
  description: z.string(),
  score: z.number().describe("Relevance score for the query, in (0, 1)"),
  price: toolPriceSchema,
  input: toolInputSchema,
});

export const toolSearchQuerySchema = z.object({
  q: z.string().min(1).describe("What you need, in natural language"),
  // The discovery provider (Monid) caps the page at 20 results.
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(20)
    .default(20)
    .describe("Maximum number of tools to return (1-20)")
    .meta({ example: 20 }),
});

/** Discovery answers with the bare tool array: no envelope, no query echo. */
export const toolSearchOutputSchema = z.array(toolSchema);

/** A settled tool call: the provider's payload on success, a reason otherwise. */
export const toolCallSuccessSchema = z.object({
  success: z.literal(true),
  data: z.unknown().describe("The tool's response payload"),
});

export const toolCallFailedSchema = z.object({
  success: z.literal(false),
  error: z.string().describe("Why the call failed"),
});

const toolCallResultSchemas = [toolCallSuccessSchema, toolCallFailedSchema] as const;

export const toolCallResultSchema = z.discriminatedUnion("success", toolCallResultSchemas);

export type Tool = z.infer<typeof toolSchema>;
export type ToolPrice = z.infer<typeof toolPriceSchema>;
export type ToolSearchQuery = z.infer<typeof toolSearchQuerySchema>;
export type ToolSearchOutput = z.infer<typeof toolSearchOutputSchema>;
export type ToolCallResult = z.infer<typeof toolCallResultSchema>;
