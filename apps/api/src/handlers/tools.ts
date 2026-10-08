import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import {
  toolInspectOutputSchema,
  toolInspectParamsSchema,
  toolSearchOutputSchema,
  toolSearchQuerySchema,
} from "@spaceobject/core";

import { Env } from "../env";
import { inspectMonidTool, searchMonidTools } from "../lib/monid";

export const searchToolsRoute = createRoute({
  method: "get",
  path: "/",
  request: {
    query: toolSearchQuerySchema,
  },
  responses: {
    200: {
      description: "Payable tools found",
      content: {
        "application/json": {
          schema: toolSearchOutputSchema,
        },
      },
    },
  },
});

export const inspectToolRoute = createRoute({
  method: "post",
  path: "/inspect",
  request: {
    body: {
      content: {
        "application/json": {
          schema: toolInspectParamsSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Tool details found",
      content: {
        "application/json": {
          schema: toolInspectOutputSchema,
        },
      },
    },
  },
});

export const toolsHandlers = new OpenAPIHono<Env>()
  .openapi(searchToolsRoute, async (c) => {
    return c.json({
      query: c.req.valid("query").q,
      tools: await searchMonidTools(c.req.valid("query"), c.env.MONID_API_KEY),
    });
  })
  .openapi(inspectToolRoute, async (c) => {
    return c.json(await inspectMonidTool(c.req.valid("json"), c.env.MONID_API_KEY));
  });
