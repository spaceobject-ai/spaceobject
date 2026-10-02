import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClientType } from "@spaceobject/api/rpc";
import { Hono } from "hono";
import { hc } from "hono/client";
import { logger } from "hono/logger";

import { registerGetAgentTool } from "./tools/get-agent";
import { registerGetJobTool } from "./tools/get-job";
import { registerListAgentFeedbacksTool } from "./tools/list-agent-feedbacks";
import { registerListAgentServicesTool } from "./tools/list-agent-services";
import { registerListJobsTool } from "./tools/list-jobs";
import { registerSearchAgentsTool } from "./tools/search-agents";

import { Env } from "./env";

const app = new Hono<Env>();

app
  .use(logger())
  .use((c, next) => {
    // The binding keeps the call on Cloudflare's internal network; a plain
    // fetch to the API's workers.dev URL fails with error 1042.
    const apiClient = hc<ApiClientType>(c.env.BASE_API_URL, {
      fetch: c.env.API.fetch.bind(c.env.API),
    });
    c.set("apiClient", apiClient);

    return next();
  })
  .all("/", async (c) => {
    const server = new McpServer({ name: "spaceobject", version: "0.1.0" });

    const apiClient = c.get("apiClient");

    const tools = [
      // Agents
      registerSearchAgentsTool(apiClient),
      registerGetAgentTool(apiClient),
      registerListAgentServicesTool(apiClient),
      registerListAgentFeedbacksTool(apiClient),
      // Jobs
      registerListJobsTool(apiClient),
      registerGetJobTool(apiClient),
    ];

    tools.forEach((register) => register(server));

    // Tools must register before connecting; the SDK rejects capability
    // registration after the transport is attached.
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);

    return transport.handleRequest(c);
  });

export default app;
