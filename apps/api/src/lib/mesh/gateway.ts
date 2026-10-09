import { createGatewayRuntime } from "@graphql-hive/gateway-runtime";
import type { DocumentNode } from "graphql";
import http from "@graphql-mesh/transport-http";

import { getSdk, type Sdk } from "./__generated/sdk";
import { resolvers } from "./resolvers";
import supergraph from "./supergraph.graphql?raw";

// The gateway is embedded in the worker instead of running as a separate
// deployment, so the REST handlers serve one unified schema (the public
// /v1/graphql route was removed — the mesh powers the handlers only).
// transports must be passed explicitly for workerd: dynamic transport loading
// does not survive bundling. fetchAPI pins the server to the platform's
// fetch/Response classes — the whatwg-node ponyfill Response is not valid to
// return from a worker handler.
const createMesh = () =>
  createGatewayRuntime({
    supergraph,
    transports: { http },
    additionalResolvers: resolvers,
    fetchAPI: { fetch, Response, Request, Headers },
    // Abort upstream subgraph calls when the client request is cancelled.
    upstreamCancellation: true,
    landingPage: false,
  });

type Mesh = ReturnType<typeof createMesh>;

// The supergraph is static, so build the runtime once per isolate.
let mesh: Mesh | undefined;

export const getMesh = (): Mesh => {
  if (!mesh) mesh = createMesh();
  return mesh;
};

// Typed client over the unified schema for the REST handlers. The runtime's
// requester also serves subscriptions; the API only issues queries, so the
// promise-only narrowing lives behind this one cast.
export const getMeshSdk = (): Sdk =>
  getSdk(
    async <R, V>(document: DocumentNode, variables?: V) =>
      getMesh().sdkRequester(document, variables) as Promise<R>,
  );
