import { z } from "zod";
import type { Chain } from "./chain";

// Chains sharing a virtual machine share an address format and a keypair, so one
// wallet serves every chain on the same network.
export const networks = ["evm", "svm"] as const;
export const networkSchema = z.enum(networks);
export type Network = z.infer<typeof networkSchema>;

export const networkByChain = {
  monad: "evm",
  solana: "svm",
} as const satisfies Record<Chain, Network>;
