import { expect, test } from "vite-plus/test";
import { CliError } from "../src/utils/errors.ts";
import {
  AGENT_CARD_TYPE,
  normalizeCard,
  parseAgentCard,
  parseAgentService,
  parseAgentUriCard,
  toAgentUri,
} from "../src/lib/agents.ts";

test("fills in the profile type, an empty services array and an active flag", () => {
  const card = parseAgentCard({ name: "DataAnalyst", description: "Analyzes data" });

  expect(card.type).toBe(AGENT_CARD_TYPE);
  expect(card.services).toEqual([]);
  expect(card.active).toBe(true);
});

test("keeps an explicit inactive flag", () => {
  const card = parseAgentCard({ name: "Paused", description: "Offline for now", active: false });

  expect(card.active).toBe(false);
});

test("keeps fields the flags don't cover", () => {
  const card = parseAgentCard({
    name: "DataAnalyst",
    description: "Analyzes data",
    active: true,
    x402Support: false,
    supportedTrust: ["reputation"],
    services: [{ name: "MCP", endpoint: "https://mcp.example.com", mcpTools: ["analyze"] }],
  });

  expect(card.active).toBe(true);
  expect(card.x402Support).toBe(false);
  expect(card.supportedTrust).toEqual(["reputation"]);
  expect(card.services[0]?.mcpTools).toEqual(["analyze"]);
});

test("rejects a card without a name", () => {
  expect(() => parseAgentCard({ description: "No name" })).toThrow(CliError);
});

test("normalizes the legacy endpoints field to services", () => {
  const card = parseAgentCard({
    name: "Legacy",
    description: "Uses the pre-2026 field name",
    endpoints: [{ name: "web", endpoint: "https://example.com" }],
  });

  expect(card.services).toEqual([{ name: "web", endpoint: "https://example.com" }]);
  expect("endpoints" in card).toBe(false);
});

test("services wins when a card carries both field names", () => {
  const normalized = normalizeCard({
    services: [{ name: "web", endpoint: "https://new.example.com" }],
    endpoints: [{ name: "web", endpoint: "https://old.example.com" }],
  });

  expect(normalized.services).toEqual([{ name: "web", endpoint: "https://new.example.com" }]);
});

test("rejects a service without an endpoint", () => {
  expect(() => parseAgentService({ name: "MCP" })).toThrow(CliError);
});

test("the agent URI round-trips through base64", () => {
  const card = parseAgentCard({
    name: "DataAnalyst",
    description: "Analyzes data",
    registrations: [{ agentId: 42, agentRegistry: "eip155:143:0x8004" }],
  });

  const uri = toAgentUri(card);
  expect(uri.startsWith("data:application/json;base64,")).toBe(true);

  const decoded = JSON.parse(
    Buffer.from(uri.slice("data:application/json;base64,".length), "base64").toString("utf8"),
  );
  expect(decoded).toEqual(card);
});

test("parseAgentUriCard inverts toAgentUri", () => {
  const card = parseAgentCard({
    name: "DataAnalyst",
    description: "Analyzes data",
    services: [{ name: "MCP", endpoint: "https://mcp.example.com" }],
    registrations: [{ agentId: 42, agentRegistry: "eip155:143:0x8004" }],
  });

  expect(parseAgentUriCard(toAgentUri(card))).toEqual(card);
});

test("parseAgentUriCard normalizes legacy endpoints in onchain cards", () => {
  const uri = `data:application/json;base64,${Buffer.from(
    JSON.stringify({
      name: "Legacy",
      description: "Pre-2026 card",
      endpoints: [{ name: "web", endpoint: "https://example.com" }],
    }),
  ).toString("base64")}`;

  const card = parseAgentUriCard(uri);
  expect(card).not.toBeInstanceOf(CliError);
  if (card instanceof CliError) return;
  expect(card.services).toEqual([{ name: "web", endpoint: "https://example.com" }]);
});

test("parseAgentUriCard returns an error for non-data URIs", () => {
  expect(parseAgentUriCard("https://example.com/agent.json")).toBeInstanceOf(CliError);
});

test("parseAgentUriCard returns an error for malformed JSON", () => {
  const uri = `data:application/json;base64,${Buffer.from("not json").toString("base64")}`;
  expect(parseAgentUriCard(uri)).toBeInstanceOf(CliError);
});

test("parseAgentUriCard returns an error for an invalid card", () => {
  const uri = `data:application/json;base64,${Buffer.from(
    JSON.stringify({ description: "No name" }),
  ).toString("base64")}`;
  expect(parseAgentUriCard(uri)).toBeInstanceOf(CliError);
});
