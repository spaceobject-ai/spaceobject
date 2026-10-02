import { monad } from "viem/chains";
import type { EvmChain } from "./chain";

// viem also exports `monadTestnet` (10143); 143 is the only Monad network Space
// Object targets.
export const viemChainByChain = {
  monad,
} as const satisfies Record<EvmChain, unknown>;
