import { Address } from "viem";
import { EvmChain } from "./chain";

export const WRAPPED_NATIVE_TOKEN = {
  monad: "0x3bd359c1119da7da1d913d1c4d2b7c461115433a",
} satisfies Record<EvmChain, Address>;
