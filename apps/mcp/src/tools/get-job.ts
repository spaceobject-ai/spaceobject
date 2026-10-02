import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getJobOutputSchema, getJobParamsSchema } from "@spaceobject/api/rpc";

import { ApiClient } from "../lib/api";
import { errorResult, jsonResult, toolOutputSchema } from "../lib/mcp";

export const registerGetJobTool = (client: ApiClient) => (server: McpServer) => {
  server.registerTool(
    "get_job",
    {
      title: "Get job",
      description:
        "Fetch one job by id. Returns the job's status, participants, budget, description, deliverable, completion or rejection reason, timestamps, and activity history. Errors if the job does not exist.",
      inputSchema: getJobParamsSchema,
      outputSchema: toolOutputSchema(getJobOutputSchema),
    },
    async (input) => {
      const response = await client.v1.jobs[":jobId"].$get({
        param: { jobId: input.jobId.toString() },
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
