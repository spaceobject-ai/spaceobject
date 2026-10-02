import type { EvmChain, Network } from "@spaceobject/core";

// The CLI operates on Monad only for now. When another EVM chain lands, add it
// to the enum in @spaceobject/core, reintroduce a `--chain` option on each
// command, and thread the parsed value through — every helper already takes the
// chain as a parameter.
export const activeChain = "monad" satisfies EvmChain;

// CLI-facing display names. Kept separate from viem's chain configs, which name
// chains for RPC/wallet purposes, not for how Space Object wants them read.
export const chainDisplayName = {
  monad: "Monad",
} as const satisfies Record<EvmChain, string>;

export const networkDisplayName = {
  evm: "EVM",
  svm: "SVM",
} as const satisfies Record<Network, string>;
