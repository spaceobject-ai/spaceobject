import type { ApiClientType } from "@spaceobject/api/rpc";
import { SPACE_OBJECT_API_URL } from "@spaceobject/core";
import { hc } from "hono/client";
import type { ClientResponse } from "hono/client";
import { CliError } from "../utils/errors.ts";

// SUN_API_URL reroutes CLI→API calls to a local Worker (`wrangler dev`) without
// touching config files; unset means production. The override lives here, at
// the consumer, so core exports a plain constant.
export const API_URL = process.env.SUN_API_URL ?? SPACE_OBJECT_API_URL;

export const api = hc<ApiClientType>(API_URL);

type SuccessJson<R> =
  R extends ClientResponse<infer T, infer S, "json"> ? (S extends 200 ? T : never) : never;

/**
 * Unwraps a Space Object API response: network failures and non-2xx statuses become
 * CliErrors, and a caller-supplied error replaces the generic one on 404.
 */
export async function requestJson<R extends ClientResponse<unknown>>(
  request: Promise<R>,
  notFound?: CliError,
): Promise<SuccessJson<R>> {
  const response = await request.catch(() => null);
  if (response === null)
    throw new CliError(
      "API_REQUEST_FAILED",
      `Could not reach the Space Object API at ${SPACE_OBJECT_API_URL}.`,
      "Check your network connection, then run the command again.",
    );
  if (response.status === 404 && notFound) throw notFound;
  if (!response.ok)
    throw new CliError(
      "API_REQUEST_FAILED",
      `Space Object API request failed: HTTP ${response.status}.`,
    );

  return response.json() as Promise<SuccessJson<R>>;
}

/** Onchain agent ids are uint256 values; local uuids must not reach the API. */
export function requireOnchainAgentId(value: string): string {
  if (!/^\d+$/.test(value))
    throw new CliError(
      "AGENT_ID_INVALID",
      `${value} is not an onchain agent id.`,
      "Onchain agent ids are numeric — run `sun agent discover <query>` to find them.",
    );

  return value;
}
