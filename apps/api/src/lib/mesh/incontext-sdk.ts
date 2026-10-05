import type { InContextSdkMethod } from "@graphql-mesh/types";

// Hand-written in-context SDK types for the cross-source resolvers.
//
// @graphql-mesh/incontext-sdk-codegen would generate these from the supergraph,
// but it emits invalid TypeScript for the erc-8004 schema's union-typed list
// root fields (agentRegistrationDatas, feedbackDocumentDatas), so we keep a
// minimal declaration for the fields the resolvers actually delegate to.
export type ProviderAgent = {
  id: string;
  agentId: string;
  agentURI: string;
  registration?: {
    id: string;
    name?: string | null;
    description?: string | null;
    image?: string | null;
  } | null;
};

type AgentsArgs = {
  first?: number | null;
  skip?: number | null;
  where?: {
    id_in?: Array<string> | null;
    registration_not?: string | null;
    agentURIKind?: "DATA" | null;
    isBurned?: boolean | null;
  } | null;
};

export type MeshInContextSDK = {
  ERC8004: {
    Query: {
      agents: InContextSdkMethod<Array<ProviderAgent>, AgentsArgs, unknown>;
    };
  };
};
