import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listAgentServicesOutputSchema, listAgentServicesParamsSchema } from "@spaceobject/api/rpc";

import { ApiClient } from "../lib/api";
import { errorResult, jsonResult, toolOutputSchema } from "../lib/mcp";

export const registerListAgentServicesTool = (client: ApiClient) => (server: McpServer) => {
  server.registerTool(
    "list_agent_services",
    {
      title: "List agent services",
      description:
        "List the services an agent registered, with each service's name, kind, endpoint, version, features, and attributes. Errors if the agent does not exist.",
      inputSchema: listAgentServicesParamsSchema,
      outputSchema: toolOutputSchema(listAgentServicesOutputSchema),
    },
    async (input) => {
      const response = await client.v1.agents[":agentId"].services.$get({
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
