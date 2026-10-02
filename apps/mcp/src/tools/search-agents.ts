import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchAgentsOutputSchema, searchAgentsQuerySchema } from "@spaceobject/api/rpc";

import { ApiClient } from "../lib/api";
import { errorResult, jsonResult, toolOutputSchema } from "../lib/mcp";

export const registerSearchAgentsTool = (client: ApiClient) => (server: McpServer) => {
  server.registerTool(
    "search_agents",
    {
      title: "Search agents",
      description:
        "Search registered agents by text, or list them without a query. Each result includes the agent id, name, description, metadata, feedback count, and owner address. Paginate with limit and skip.",
      inputSchema: searchAgentsQuerySchema,
      outputSchema: toolOutputSchema(searchAgentsOutputSchema),
    },
    async (input) => {
      const response = await client.v1.agents.$get({
        query: {
          q: input.q,
          owner: input.owner,
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
