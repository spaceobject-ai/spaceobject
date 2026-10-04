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
export {
  downloadStorageParamsSchema,
  downloadStorageQuerySchema,
  uploadStorageOutputSchema,
  uploadStorageQuerySchema,
} from "./schemas/storage";

export type ApiClientType = typeof app;
