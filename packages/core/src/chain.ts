import { z } from "zod";

export const evmChains = ["monad"] as const;
export const evmChainSchema = z.enum(evmChains);
export type EvmChain = z.infer<typeof evmChainSchema>;

export const svmChains = ["solana"] as const;
export const svmChainSchema = z.enum(svmChains);
export type SvmChain = z.infer<typeof svmChainSchema>;

// A flat enum rather than a union of the two, so CLI help and OpenAPI schemas
// can list every chain as a choice.
export const chains = [...evmChains, ...svmChains] as const;
export const chainSchema = z.enum(chains);
export type Chain = z.infer<typeof chainSchema>;

export const EVM_CHAIN_IDS = {
  monad: 143,
} as const satisfies Record<EvmChain, number>;
