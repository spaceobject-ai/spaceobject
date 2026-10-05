import type { Sdk } from "./lib/mesh/__generated/sdk";

export interface GlobalVariables {
  mesh: Sdk;
}

export interface Env<TVariables extends object = {}> {
  Bindings: CloudflareBindings;
  Variables: GlobalVariables & TVariables;
}
