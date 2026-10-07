import type { Sdk } from "./lib/mesh/__generated/sdk";

// Secrets set with `wrangler secret put` are invisible to both `wrangler
// types` and CI (typegen only sees wrangler.jsonc vars plus .dev.vars), so
// they are declared here. Keep .dev.vars in sync with this list and re-run
// `vpr typegen` after changes; the gateway URL is not a Worker secret —
// downloads go directly from the CLI to the public gateway.
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
