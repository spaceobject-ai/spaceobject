import DataLoader from "dataloader";
import type { GraphQLResolveInfo } from "graphql";

import { EVM_CHAIN_IDS, identityRegistryByChain } from "@spaceobject/core";

import { agentEntityId } from "../../utils/agent";
import type { MeshInContextSDK, ProviderAgent } from "./incontext-sdk";

// Job.providerAgentId is the numeric ERC-8004 agent id; the erc-8004 subgraph
// keys Agent (and its 1:1 AgentRegistration) by the hex-encoded
// `chainId:registry:agentId` entity id, so the join recomputes it here.
const providerAgentEntityId = (providerAgentId: string) =>
  agentEntityId(EVM_CHAIN_IDS.monad, identityRegistryByChain.monad, providerAgentId);

// providerAgentId "0" means the escrow has no provider assigned.
const resolveProviderAgentEntityId = (job: { providerAgentId: string }) =>
  job.providerAgentId === "0" ? null : providerAgentEntityId(job.providerAgentId);

// The resolver always fetches this selection: `id` keys the batch response and
// the rest covers the REST job payload. assignedAgent subfields requested on
// /v1/graphql beyond this selection resolve to null.
const providerAgentSelection = /* GraphQL */ `
  {
    id
    agentId
    registration {
      name
      image
    }
  }
`;

const createProviderAgentLoader = (context: MeshInContextSDK, info: GraphQLResolveInfo) =>
  new DataLoader<string, ProviderAgent | null>(async (entityIds) => {
    const agents = await context.ERC8004.Query.agents({
      root: {},
      args: {
        first: entityIds.length,
        where: {
          id_in: [...entityIds],
          registration_not: null,
          agentURIKind: "DATA",
          isBurned: false,
        },
      },
      context,
      info,
      selectionSet: providerAgentSelection,
    });
    const byEntityId = new Map(agents.map((agent) => [agent.id, agent]));
    return entityIds.map((entityId) => byEntityId.get(entityId) ?? null);
  });

// One loader per request so a jobs page resolves every provider agent in a
// single agents(id_in: [...]) query. The gateway context object is unique to a
// request, which makes it the batching scope.
const providerAgentLoaders = new WeakMap<object, DataLoader<string, ProviderAgent | null>>();

const providerAgentLoader = (context: MeshInContextSDK, info: GraphQLResolveInfo) => {
  const existing = providerAgentLoaders.get(context);
  if (existing) return existing;

  const loader = createProviderAgentLoader(context, info);
  providerAgentLoaders.set(context, loader);
  return loader;
};

export const resolvers = {
  Job: {
    assignedAgent: (
      job: { providerAgentId: string },
      _: unknown,
      context: MeshInContextSDK,
      info: GraphQLResolveInfo,
    ) => {
      const entityId = resolveProviderAgentEntityId(job);
      if (!entityId) return null;
      return providerAgentLoader(context, info).load(entityId);
    },
  },
};
