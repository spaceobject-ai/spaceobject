import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import { toolSearchOutputSchema, toolSearchQuerySchema } from "@spaceobject/core";

import { Env } from "../env";
import { searchMonidTools } from "../lib/monid";

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

export const toolsHandlers = new OpenAPIHono<Env>().openapi(searchToolsRoute, async (c) => {
  return c.json(await searchMonidTools(c.req.valid("query"), c.env.MONID_API_KEY));
});
