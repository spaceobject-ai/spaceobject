import { hc } from "hono/client";
import { ApiClientType } from "@spaceobject/api/rpc";

export type ApiClient = ReturnType<typeof hc<ApiClientType>>;
