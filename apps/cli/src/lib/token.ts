import { type EvmChain, viemChainByChain } from "@spaceobject/core";
import pc from "picocolors";
import { type Address, createPublicClient, erc20Abi, formatUnits, http, parseUnits } from "viem";
import type { ErrorCode } from "../utils/errors.ts";
import { CliError } from "../utils/errors.ts";
import { getCached, setCached } from "./cache.ts";

export type TokenMetadata = { decimals: number; symbol: string };

/**
 * Reads a token's decimals and symbol, cached forever per chain and address
 * since both are immutable for a deployed contract. Returns null when the
 * contract does not answer (not an ERC-20, wrong chain), so callers can fall
 * back to raw base units.
 */
export async function readTokenMetadata(
  chain: EvmChain,
  token: Address,
): Promise<TokenMetadata | null> {
  const key = `${chain}:${token.toLowerCase()}`;
  const cached = getCached<TokenMetadata>("token-metadata", key);
  if (cached) return cached;

  const client = createPublicClient({ chain: viemChainByChain[chain], transport: http() });
  const contract = { address: token, abi: erc20Abi } as const;
  const metadata = await Promise.all([
    client.readContract({ ...contract, functionName: "decimals" }),
    client.readContract({ ...contract, functionName: "symbol" }),
  ])
    .then(([decimals, symbol]) => ({ decimals, symbol }))
    .catch(() => null);

  if (metadata) setCached("token-metadata", key, metadata);
  return metadata;
}

/** "0.05 WMON" when metadata is known, "50000000000000000 base units" when not. */
export function formatTokenAmount(amount: bigint, metadata: TokenMetadata | null): string {
  if (!metadata) return `${amount} base units`;
  return `${formatUnits(amount, metadata.decimals)} ${metadata.symbol}`;
}

/** "WMON (0x...)" when a symbol is known, else just the address. */
export function tokenLabel(token: string, symbol: string | null): string {
  return symbol ? `${symbol} ${pc.dim(`(${token})`)}` : token;
}

/**
 * Parses a token amount from the command line: raw base units when asUnit is
 * set, otherwise decimal token units scaled by decimals. errorCode lets each
 * caller keep its own CliError code for invalid input.
 */
export function parseTokenAmount(
  amount: string,
  asUnit: boolean,
  decimals: number,
  errorCode: ErrorCode,
): bigint {
  if (asUnit) {
    if (!/^\d+$/.test(amount))
      throw new CliError(errorCode, `${amount} is not an integer amount of base units.`);
    return BigInt(amount);
  }

  if (!/^\d+(\.\d+)?$/.test(amount))
    throw new CliError(errorCode, `${amount} is not a token amount, e.g. 1.5 or 20.`);
  return parseUnits(amount, decimals);
}
