import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listJobsOutputSchema, listJobsQuerySchema } from "@spaceobject/api/rpc";

import { ApiClient } from "../lib/api";
import { errorResult, jsonResult, toolOutputSchema } from "../lib/mcp";

export const registerListJobsTool = (client: ApiClient) => (server: McpServer) => {
  server.registerTool(
    "list_jobs",
    {
      title: "List jobs",
      description:
        "List jobs, optionally filtered by client address, provider address, evaluator address, provider agent ID, or status. Pass the zero address as provider or 0 as agentId to find unassigned jobs. Each job includes its status, participants, budget, description, deliverable, completion or rejection reason, timestamps, and activity history. Paginate with limit and skip.",
      inputSchema: listJobsQuerySchema,
      outputSchema: toolOutputSchema(listJobsOutputSchema),
    },
    async (input) => {
      const response = await client.v1.jobs.$get({
        query: {
          client: input.client,
          provider: input.provider,
          evaluator: input.evaluator,
          agentId: input.agentId?.toString(),
          status: input.status,
          limit: String(input.limit),
          skip: String(input.skip),
        },
      });

      if (!response.ok) {
        const text = await response.text();
        return errorResult(text);
      }

      const json = await response.json();
      return jsonResult(json);
    },
  );
};
