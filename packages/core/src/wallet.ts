import { z } from "zod";
import { networkSchema } from "./network";

// Space Object's wallet entity. Wallet providers each model wallets their own
// way, so every provider adapter maps its representation onto this shape.
export const walletSchema = z.object({
  id: z.string(),
  // Address format follows the network, so the chain-specific check belongs to
  // whichever consumer is about to use the address.
  address: z.string(),
  network: networkSchema,
});

export type Wallet = z.infer<typeof walletSchema>;
