import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { CliError } from "../utils/errors.ts";
import { jsonStringSchema } from "../utils/json.ts";

export const AGENT_CARD_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

// Loose objects keep fields the flags don't cover (mcpTools, capabilities,
// custom extensions) intact — --data/--file exist precisely to carry them, and
// edits must not strip them.
export const agentServiceSchema = z.looseObject({
  name: z.string().min(1),
  endpoint: z.string().min(1),
  version: z.string().optional(),
});

export type AgentService = z.infer<typeof agentServiceSchema>;

const registrationSchema = z.looseObject({
  agentId: z.number(),
  agentRegistry: z.string(),
});

export const agentCardSchema = z.looseObject({
  type: z.string().prefault(AGENT_CARD_TYPE),
  name: z.string().min(1),
  description: z.string(),
  image: z.string().optional(),
  // Agents are active on create; `sun agent deactivate` takes one offline
  // without deleting its card. Cards written before this field existed read
  // back as active.
  active: z.boolean().prefault(true),
  services: z.array(agentServiceSchema).prefault([]),
  registrations: z.array(registrationSchema).optional(),
  updatedAt: z.number().optional(),
});

export type AgentCard = z.infer<typeof agentCardSchema>;

export function parseAgentCard(input: Record<string, unknown>): AgentCard {
  const result = agentCardSchema.safeParse(normalizeCard(input));
  if (!result.success)
    throw new CliError(
      "AGENT_CARD_INVALID",
      `Invalid agent card: ${z.prettifyError(result.error)}`,
    );

  return result.data;
}

// Cards in the wild still use the legacy `endpoints` field name; normalize to
// `services` (the EIP-8004 name since Jan 2026) so the service subcommands and
// synced cards operate on a single field.
export function normalizeCard(input: Record<string, unknown>): Record<string, unknown> {
  if (!("endpoints" in input) || "services" in input) return input;

  const { endpoints, ...rest } = input;
  return { ...rest, services: endpoints };
}

export function parseAgentService(input: Record<string, unknown>): AgentService {
  const result = agentServiceSchema.safeParse(input);
  if (!result.success)
    throw new CliError("AGENT_CARD_INVALID", `Invalid service: ${z.prettifyError(result.error)}`);

  return result.data;
}

// Agents live locally at ~/.spaceobject/sun/agents/<user_id>/<agent_id>.json as plain
// ERC-8004 agent cards; the local id is the filename, never part of the card.
const AGENTS_DIR = path.join(os.homedir(), ".spaceobject", "sun", "agents");

function agentPath(userId: string, agentId: string) {
  return path.join(AGENTS_DIR, userId, `${agentId}.json`);
}

export async function readAgentCard(userId: string, agentId: string): Promise<AgentCard> {
  const raw = await fs.readFile(agentPath(userId, agentId), "utf8").catch(() => null);
  if (raw === null)
    throw new CliError(
      "AGENT_NOT_FOUND",
      `No local agent with id ${agentId}.`,
      "Run `sun agent list` to see this account's agents.",
    );

  const parsed = jsonStringSchema.safeParse(raw);
  if (!parsed.success)
    throw new CliError("AGENT_CARD_INVALID", `${agentPath(userId, agentId)} is not valid JSON.`);

  return parseAgentCard(requireJsonObject(parsed.data, agentPath(userId, agentId)));
}

export function requireJsonObject(value: unknown, source: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new CliError("AGENT_CARD_INVALID", `${source} must contain a JSON object.`);

  return value as Record<string, unknown>;
}

export async function listAgentCards(
  userId: string,
): Promise<Array<{ id: string; card: AgentCard }>> {
  const entries = await fs.readdir(path.join(AGENTS_DIR, userId)).catch(() => [] as string[]);
  const ids = entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.slice(0, -".json".length))
    .sort();

  return Promise.all(ids.map(async (id) => ({ id, card: await readAgentCard(userId, id) })));
}

export async function writeAgentCard(
  userId: string,
  agentId: string,
  card: AgentCard,
): Promise<string> {
  const filePath = agentPath(userId, agentId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(card, null, 2)}\n`);
  return filePath;
}

// A data URI keeps the whole card onchain: perfectly immutable and free of
// external hosting, at the cost of gas proportional to card size.
export function toAgentUri(card: AgentCard): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(card)).toString("base64")}`;
}

// The inverse of toAgentUri, for pulling onchain agents back into local cards.
// Anything else (ipfs://, https://, malformed JSON) cannot become a local
// card; the error is returned so bulk pulls can report it without try/catch.
export function parseAgentUriCard(agentUri: string): AgentCard | CliError {
  const base64 = agentUri.match(/^data:application\/json;base64,(.*)$/)?.[1];
  if (base64 === undefined)
    return new CliError("AGENT_PULL_FAILED", "The agent URI is not a base64 JSON data URI.");

  const parsed = jsonStringSchema.safeParse(Buffer.from(base64, "base64").toString("utf8"));
  if (!parsed.success || typeof parsed.data !== "object" || parsed.data === null)
    return new CliError("AGENT_PULL_FAILED", "The agent URI does not contain a JSON object.");

  const card = agentCardSchema.safeParse(normalizeCard(parsed.data as Record<string, unknown>));
  if (!card.success)
    return new CliError(
      "AGENT_PULL_FAILED",
      `The agent URI is not a valid agent card: ${z.prettifyError(card.error)}`,
    );

  return card.data;
}
