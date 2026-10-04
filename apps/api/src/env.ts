import type { Sdk } from "./lib/mesh/__generated/sdk";

// Secrets are invisible to `wrangler types` (it only sees wrangler.jsonc vars),
// so the subgraph keys, storage credentials, and auth overrides are declared
// here for the handlers.
export interface WorkerSecrets {
  ERC_8004_SUBGRAPH_API_KEY: string;
  ERC_8183_SUBGRAPH_API_KEY: string;
  QUICKNODE_IPFS_API_KEY: string;
  QUICKNODE_GATEWAY_URL: string;
  /** Overridable for tests; production reads Privy's published JWKS. */
  PRIVY_JWKS_URL?: string;
}

export interface GlobalVariables {
  mesh: Sdk;
}

export interface Env<TVariables extends object = {}> {
  Bindings: CloudflareBindings & WorkerSecrets;
  Variables: GlobalVariables & TVariables;
}
