import { deliverableHashSchema } from "@spaceobject/core";
import { z } from "zod";

// Schema-only module: keep this free of handler imports so @spaceobject/api/rpc
// consumers (apps/mcp) get the definitions without route registration side
// effects.

export const uploadStorageQuerySchema = z.object({
  name: deliverableHashSchema.describe(
    "Deliverable hash; the pin is stored under this name so downloads can resolve it",
  ),
});

export const uploadStorageOutputSchema = z.object({
  cid: z.string().min(1).describe("IPFS CID of the pinned bytes"),
  name: z.string().describe("Pin name, the deliverable hash"),
});

export const downloadStorageParamsSchema = z.object({
  sha256: deliverableHashSchema,
});

export const downloadStorageQuerySchema = z.object({
  cid: z.string().min(1).optional().describe("Known CID; skips pin-name resolution"),
});
