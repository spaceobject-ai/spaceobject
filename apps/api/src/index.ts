import { OpenAPIHono as Hono } from "@hono/zod-openapi";
import { problemDetailsHandler } from "hono-problem-details";
import { logger } from "hono/logger";

import { getMesh, getMeshSdk } from "./lib/mesh/gateway";

import { agentHandlers } from "./handlers/agent";
import { jobHandlers } from "./handlers/jobs";
import { storageHandlers } from "./handlers/storage";
import { Env } from "./env";

const app = new Hono<Env>()
  .use(logger())
  .onError(
    problemDetailsHandler({
      autoInstance: true,
    }),
  )
  .basePath("/v1")
  .use(async (c, next) => {
    // The gateway is isolate-scoped; only the typed SDK wrapper is per-request.
    c.set("mesh", getMeshSdk());
    return next();
  })
  // Unified supergraph: both subgraphs plus the stitched Job.providerAgent
  // relationship, playable at /v1/graphql.
  .all("/graphql", (c) => getMesh()(c.req.raw, c.env, c.executionCtx))
  .route("/agents", agentHandlers)
  .route("/jobs", jobHandlers)
  .route("/storage", storageHandlers);

export default app;
