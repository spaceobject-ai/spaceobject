import { addressSchema, agentIdSchema, jobIdSchema } from "@spaceobject/utils";
import { z } from "zod";

// Schema-only module: keep this free of handler imports so @spaceobject/api/rpc
// consumers (apps/mcp) get the definitions without route registration side
// effects. Plain zod `.describe()`/`.meta()` metadata is picked up by the
// OpenAPI generator via zod's global registry.
export const jobActivitySchema = z.object({
  kind: z.string(),
  address: z.string().nullable(),
  amount: z.string().nullable(),
  timestamp: z.number(),
  txHash: z.string(),
});

// assignedAgent is stitched across the erc-8004 subgraph from providerAgentId;
// null until a provider is assigned or the registration is not indexed (yet).
export const jobAssignedAgentSchema = z.object({
  id: z.string().describe("ERC-8004 agent ID, usable with GET /v1/agents/{agentId}"),
  name: z.string().nullable(),
  image: z.string().nullable(),
});

export const jobSummarySchema = z.object({
  id: z.string(),
  status: z.string(),
  client: z.string(),
  provider: z.string().nullable(),
  evaluator: z.string(),
  assignedAgent: jobAssignedAgentSchema.nullable(),
  description: z.string(),
  deliverable: z.string().nullable(),
  completionReason: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  budget: z
    .object({
      amount: z.string(),
      token: z.string(),
    })
    .nullable(),
  expiresAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  activities: z.array(jobActivitySchema),
});

export const listJobsQuerySchema = z.object({
  client: addressSchema.optional().describe("Job client address"),
  provider: addressSchema
    .optional()
    .describe("Job provider address. Pass the zero address to find jobs with no provider"),
  evaluator: addressSchema.optional().describe("Job evaluator address"),
  agentId: agentIdSchema
    .optional()
    .describe("Job provider agent ID. Pass 0 to find jobs not assigned to any agent"),
  status: z
    .enum(["OPEN", "BUDGET_SET", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"])
    .optional()
    .describe(
      "Job status. BUDGET_SET means open with a priced budget awaiting funding; EXPIRED includes jobs past their deadline even if no refund was claimed yet",
    ),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(1000)
    .default(20)
    .describe("Maximum results per query")
    .meta({ example: 20 }),
  skip: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(5000)
    .default(0)
    .describe("Number of results to skip"),
});
export const listJobsOutputSchema = z.array(jobSummarySchema);

export const getJobParamsSchema = z.object({
  jobId: jobIdSchema.describe("Job ID"),
});
export const getJobOutputSchema = jobSummarySchema;
