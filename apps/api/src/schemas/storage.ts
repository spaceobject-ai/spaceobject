import { z } from "zod";

// Schema-only module: keep this free of handler imports so @spaceobject/api/rpc
// consumers (apps/mcp) get the definitions without route registration side
// effects.

export const uploadStorageOutputSchema = z.object({
  cid: z.string().min(1).describe("IPFS CIDv0 of the pinned bytes"),
  name: z.string().describe("Pin name (a UUID)"),
});
