import type { CodegenConfig } from "@graphql-codegen/cli";

// Generates typed clients from the composed supergraph:
// - sdk.ts drives the REST handlers through the unified schema
// - incontext-sdk.ts types the cross-source resolvers (context.ERC8004.*)
const config: CodegenConfig = {
  schema: "src/lib/mesh/supergraph.graphql",
  documents: ["src/lib/operations/*.graphql"],
  ignoreNoDocuments: true,
  generates: {
    "src/lib/mesh/__generated/sdk.ts": {
      plugins: ["typescript-operations", "typescript-generic-sdk"],
      config: {
        // Inlined documents keep the generated client free of graphql-tag.
        documentMode: "documentNode",
        scalars: {
          BigInt: "string",
          Bytes: "string",
          Timestamp: "string",
        },
      },
    },
  },
};

export default config;
