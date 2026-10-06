import type { Sdk } from "./lib/mesh/__generated/sdk";

// Secrets are invisible to `wrangler types` (it only sees wrangler.jsonc vars),
// so the subgraph keys and storage credentials are declared here for the
// handlers. The gateway URL is not a Worker secret: downloads go directly to
// the public gateway from the CLI.
export interface WorkerSecrets {
  ERC_8004_SUBGRAPH_API_KEY: string;
  ERC_8183_SUBGRAPH_API_KEY: string;
  QUICKNODE_IPFS_API_KEY: string;
}

export interface GlobalVariables {
  mesh: Sdk;
}

export interface Env<TVariables extends object = {}> {
  Bindings: CloudflareBindings & WorkerSecrets;
  Variables: GlobalVariables & TVariables;
}
