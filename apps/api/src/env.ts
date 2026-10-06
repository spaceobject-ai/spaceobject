import type { Sdk } from "./lib/mesh/__generated/sdk";

// Secrets are invisible to `wrangler types` (it only sees wrangler.jsonc vars),
// so the subgraph keys and storage credentials are declared here for the
// handlers. Privy verification needs no secret: the app's public JWKS endpoint
// is fetched at runtime.
export interface WorkerSecrets {
  ERC_8004_SUBGRAPH_API_KEY: string;
  ERC_8183_SUBGRAPH_API_KEY: string;
  QUICKNODE_IPFS_API_KEY: string;
  QUICKNODE_GATEWAY_URL: string;
}

export interface GlobalVariables {
  mesh: Sdk;
}

export interface Env<TVariables extends object = {}> {
  Bindings: CloudflareBindings & WorkerSecrets;
  Variables: GlobalVariables & TVariables;
}
