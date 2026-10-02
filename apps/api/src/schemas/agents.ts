import { addressSchema, agentIdSchema } from "@spaceobject/utils";
import { z } from "zod";

// Schema-only module: keep this free of handler imports so @spaceobject/api/rpc
// consumers (apps/mcp) get the definitions without route registration side
// effects. Plain zod `.describe()`/`.meta()` metadata is picked up by the
// OpenAPI generator via zod's global registry.
export const agentSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  image: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  agentURI: z.string(),
  feedbackCount: z.number(),
  owner: z.string(),
  createdAt: z.number(),
  createdAtTransaction: z.string(),
});

export const searchAgentsQuerySchema = z.object({
  q: z.string().optional().describe("Search query"),
  owner: addressSchema.optional().describe("Agent owner address"),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(1000)
    .default(50)
    .describe("Maximum results per query")
    .meta({ example: 50 }),
  skip: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(5000)
    .default(0)
    .describe("Number of results to skip"),
});
export const searchAgentsOutputSchema = z.array(agentSummarySchema);

export const getAgentParamsSchema = z.object({
  agentId: agentIdSchema,
});
// Aggregates cover the most recent 1000 active feedback entries; count is
// always exact. averageScore is null until the agent has feedback.
export const agentReputationSchema = z.object({
  count: z.number(),
  averageScore: z.number().nullable(),
  tags: z.record(z.string(), z.number()).describe("Tag occurrences across active feedback"),
});
export const getAgentOutputSchema = agentSummarySchema.extend({
  reputation: agentReputationSchema,
});

export const listAgentServicesParamsSchema = z.object({
  agentId: agentIdSchema,
});
export const listAgentServicesOutputSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    kind: z.string(),
    endpoint: z.string(),
    version: z.string().nullable(),
    features: z.array(z.object({ kind: z.string(), value: z.string() })),
    attributes: z.record(z.string(), z.unknown()),
  }),
);

export const listAgentFeedbacksParamsSchema = z.object({
  agentId: agentIdSchema,
});
export const listAgentFeedbacksQuerySchema = z.object({
  client: addressSchema.optional().describe("Only feedback left by this client address"),
  tag: z.string().optional().describe("Only feedback carrying this tag (matches tag1 or tag2)"),
  includeRevoked: z
    .stringbool()
    .default(false)
    .describe("Include revoked feedback entries")
    .meta({ example: "false" }),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(1000)
    .default(50)
    .describe("Maximum results per query")
    .meta({ example: 50 }),
  skip: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(5000)
    .default(0)
    .describe("Number of results to skip"),
});
export const listAgentFeedbacksOutputSchema = z.array(
  z.object({
    id: z.string(),
    feedbackIndex: z.number().describe("Per-client index used to revoke or respond to feedback"),
    client: z.string(),
    score: z.number(),
    tag1: z.string(),
    tag2: z.string(),
    uri: z.string(),
    revoked: z.boolean(),
    createdAt: z.number(),
    createdAtTransaction: z.string(),
  }),
);
