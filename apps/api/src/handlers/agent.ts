import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { problemDetailsResponse } from "hono-problem-details/openapi";
import { problemDetails } from "hono-problem-details";

import { EVM_CHAIN_IDS, identityRegistryByChain } from "@spaceobject/core";

import { AgentSummaryFragment } from "../lib/mesh/__generated/sdk";
import { Env } from "../env";
import { agentEntityId } from "../utils/agent";
import { parseTimestamp } from "../utils/timestamp";
import {
  getAgentOutputSchema,
  getAgentParamsSchema,
  listAgentFeedbacksOutputSchema,
  listAgentFeedbacksParamsSchema,
  listAgentFeedbacksQuerySchema,
  listAgentServicesOutputSchema,
  listAgentServicesParamsSchema,
  searchAgentsOutputSchema,
  searchAgentsQuerySchema,
} from "../schemas/agents";

const toAgentSummary = (agent: AgentSummaryFragment) => ({
  id: agent.id,
  name: agent.profile?.name ?? "",
  description: agent.profile?.description ?? "",
  image: agent.profile?.image ?? null,
  metadata: Object.fromEntries(agent.metadata.map(({ key, value }) => [key, value])),
  agentURI: agent.agentURI,
  feedbackCount: Number(agent.feedbackCount),
  owner: agent.owner?.address ?? "0x",
  createdAt: parseTimestamp(agent.createdAt),
  createdAtTransaction: agent.createdAtTransaction,
});

export const searchAgentsRoute = createRoute({
  method: "get",
  path: "/",
  request: {
    query: searchAgentsQuerySchema,
  },
  responses: {
    200: {
      description: "Agents found",
      content: {
        "application/json": {
          schema: searchAgentsOutputSchema,
        },
      },
    },
  },
});

export const getAgentRoute = createRoute({
  method: "get",
  path: "/{agentId}",
  request: {
    params: getAgentParamsSchema,
  },
  responses: {
    200: {
      description: "Agent found",
      content: {
        "application/json": {
          schema: getAgentOutputSchema,
        },
      },
    },
    404: problemDetailsResponse(404),
  },
});

export const listAgentServicesRoute = createRoute({
  method: "get",
  path: "/{agentId}/services",
  request: {
    params: listAgentServicesParamsSchema,
  },
  responses: {
    200: {
      description: "Agent services found",
      content: {
        "application/json": {
          schema: listAgentServicesOutputSchema,
        },
      },
    },
    404: problemDetailsResponse(404),
  },
});

export const listAgentFeedbacksRoute = createRoute({
  method: "get",
  path: "/{agentId}/feedbacks",
  request: {
    params: listAgentFeedbacksParamsSchema,
    query: listAgentFeedbacksQuerySchema,
  },
  responses: {
    200: {
      description: "Agent feedback found",
      content: {
        "application/json": {
          schema: listAgentFeedbacksOutputSchema,
        },
      },
    },
    404: problemDetailsResponse(404),
  },
});

const notFound = (agentId: string) =>
  problemDetails({
    status: 404,
    title: "Not found",
    detail: `Agent with id ${agentId} not found`,
    type: "Agent",
  });

const entityId = (agentId: string) =>
  agentEntityId(EVM_CHAIN_IDS.monad, identityRegistryByChain.monad, agentId);

const attributeValue = (attribute: { value: string; valueType: string }): unknown => {
  if (attribute.valueType === "NUMBER") return Number(attribute.value);
  if (attribute.valueType === "BOOLEAN") return attribute.value === "true";
  if (attribute.valueType === "JSON") {
    try {
      return JSON.parse(attribute.value);
    } catch {
      return attribute.value;
    }
  }
  return attribute.value;
};

// agentProfileSearch takes tsquery syntax, where a bare space is a syntax
// error. Quote each term and AND them together so plain text queries work.
const toFulltextQuery = (text: string) =>
  text
    .split(/\s+/)
    .map((term) => term.replaceAll("'", ""))
    .filter(Boolean)
    .map((term) => `'${term}'`)
    .join(" & ");

// The subgraph has no aggregate fields, so averageScore and the tag breakdown
// come from the sampled feedback (most recent 1000 active entries); count is
// the exact activeFeedbackCount.
const toReputation = (
  count: number,
  sample: Array<{ value: string; valueDecimals: number; tag1: string; tag2: string }>,
) => ({
  count,
  averageScore:
    sample.length > 0
      ? sample.reduce((sum, entry) => sum + Number(entry.value) / 10 ** entry.valueDecimals, 0) /
        sample.length
      : null,
  tags: sample
    .flatMap((entry) => [entry.tag1, entry.tag2])
    .filter((tag) => tag !== "")
    .reduce<Record<string, number>>((acc, tag) => ({ ...acc, [tag]: (acc[tag] ?? 0) + 1 }), {}),
});

export const agentHandlers = new OpenAPIHono<Env>()
  .openapi(searchAgentsRoute, async (c) => {
    const query = c.req.valid("query");
    const owner = query.owner?.toLowerCase();

    // agentProfileSearch requires a non-empty fulltext query, so fall back to
    // listing agents when q is absent or all punctuation.
    const text = query.q && /\w/.test(query.q) ? toFulltextQuery(query.q) : "";
    const agents = text
      ? (
          await c.var.mesh.SearchAgentProfiles({
            text,
            first: query.limit,
            skip: query.skip,
            where: {
              agent_: { agentURIKind: "DATA", isBurned: false, ...(owner ? { owner } : {}) },
            },
          })
        ).agentProfileSearch.map((profile) => profile.agent)
      : (
          await c.var.mesh.ListAgents({
            first: query.limit,
            skip: query.skip,
            where: {
              registration_not: null,
              agentURIKind: "DATA",
              isBurned: false,
              ...(owner ? { owner } : {}),
            },
          })
        ).agents;

    const result = searchAgentsOutputSchema.safeParse(agents.map(toAgentSummary));
    if (!result.success) throw new Error(result.error.message);

    return c.json(result.data);
  })
  .openapi(getAgentRoute, async (c) => {
    const agentId = c.req.valid("param").agentId.toString();

    const { agents } = await c.var.mesh.GetAgent({ id: entityId(agentId) });
    const [agent] = agents;

    if (!agent) throw notFound(agentId);

    const result = getAgentOutputSchema.safeParse({
      ...toAgentSummary(agent),
      reputation: toReputation(Number(agent.feedbackCount), agent.reputationSample),
    });
    if (!result.success) throw new Error(result.error.message);

    return c.json(result.data);
  })
  .openapi(listAgentServicesRoute, async (c) => {
    const agentId = c.req.valid("param").agentId.toString();

    const { agents } = await c.var.mesh.GetAgentServices({ id: entityId(agentId) });
    const [agent] = agents;

    if (!agent) throw notFound(agentId);

    const registration = agent.registration;
    const services = registration && "services" in registration ? registration.services : [];

    const result = listAgentServicesOutputSchema.safeParse(
      services.map((service) => ({
        id: service.id,
        name: service.name,
        kind: service.kind,
        endpoint: service.endpoint,
        version: service.version ?? null,
        features: service.features.map(({ kind, value }) => ({ kind, value })),
        attributes: Object.fromEntries(
          service.attributes.map((attribute) => [attribute.key, attributeValue(attribute)]),
        ),
      })),
    );
    if (!result.success) throw new Error(result.error.message);

    return c.json(result.data);
  })
  .openapi(listAgentFeedbacksRoute, async (c) => {
    const agentId = c.req.valid("param").agentId.toString();
    const query = c.req.valid("query");

    // Filters combine under `and` because graph-node treats `or` alongside
    // sibling keys as undefined behavior; the tag matches either tag slot.
    const conditions = [
      ...(query.includeRevoked ? [] : [{ isRevoked: false }]),
      ...(query.client ? [{ client: query.client.toLowerCase() }] : []),
      ...(query.tag ? [{ or: [{ tag1: query.tag }, { tag2: query.tag }] }] : []),
    ];
    const { agents } = await c.var.mesh.GetAgentFeedbacks({
      id: entityId(agentId),
      first: query.limit,
      skip: query.skip,
      where: conditions.length > 0 ? { and: conditions } : null,
    });
    const [agent] = agents;

    if (!agent) throw notFound(agentId);

    const result = listAgentFeedbacksOutputSchema.safeParse(
      agent.feedback.map((feedback) => ({
        id: feedback.id,
        feedbackIndex: Number(feedback.feedbackIndex),
        client: feedback.client.address,
        score: Number(feedback.value) / 10 ** feedback.valueDecimals,
        tag1: feedback.tag1,
        tag2: feedback.tag2,
        uri: feedback.feedbackURI,
        revoked: feedback.isRevoked,
        createdAt: parseTimestamp(feedback.createdAt),
        createdAtTransaction: feedback.createdAtTransaction,
      })),
    );
    if (!result.success) throw new Error(result.error.message);

    return c.json(result.data);
  });
