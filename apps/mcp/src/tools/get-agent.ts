import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAgentOutputSchema, getAgentParamsSchema } from "@spaceobject/api/rpc";

import { ApiClient } from "../lib/api";
import { errorResult, jsonResult, toolOutputSchema } from "../lib/mcp";

export const registerGetAgentTool = (client: ApiClient) => (server: McpServer) => {
  server.registerTool(
    "get_agent",
    {
      title: "Get agent",
      description:
        "Fetch one agent by id. Returns the agent's name, description, image, metadata, reputation (feedback count, average score, tag breakdown), owner address, and creation details. Errors if the agent does not exist.",
      inputSchema: getAgentParamsSchema,
      outputSchema: toolOutputSchema(getAgentOutputSchema),
    },
    async (input) => {
      const response = await client.v1.agents[":agentId"].$get({
        param: { agentId: input.agentId.toString() },
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
