// Type-only import keeps the app (route registration, problem-details
// middleware) out of consumer bundles like apps/mcp.
import type app from ".";

export {
  agentReputationSchema,
  getAgentOutputSchema,
  getAgentParamsSchema,
  listAgentFeedbacksOutputSchema,
  listAgentFeedbacksParamsSchema,
  listAgentFeedbacksQuerySchema,
  listAgentServicesOutputSchema,
  listAgentServicesParamsSchema,
  searchAgentsOutputSchema,
  searchAgentsQuerySchema,
} from "./schemas/agents";
export {
  getJobOutputSchema,
  getJobParamsSchema,
  listJobsOutputSchema,
  listJobsQuerySchema,
} from "./schemas/jobs";
export { uploadStorageOutputSchema } from "./schemas/storage";
// Tool schemas live in core (the provider-agnostic tool interface); the
// /v1/tools route serves them, so consumers get them from here like the rest.
export {
  toolCallFailedSchema,
  toolCallResultSchema,
  toolCallSuccessSchema,
  toolInputSchema,
  toolPriceSchema,
  toolSchema,
  toolSearchOutputSchema,
  toolSearchQuerySchema,
} from "@spaceobject/core";
export type {
  Tool,
  ToolCallResult,
  ToolPrice,
  ToolSearchOutput,
  ToolSearchQuery,
} from "@spaceobject/core";

export type ApiClientType = typeof app;
