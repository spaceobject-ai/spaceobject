import { z } from "zod";
import type { Network } from "./network";
import type { Wallet } from "./wallet";

// Public client identifier; the app secret never ships with clients.
export const PRIVY_APP_ID = "cmup54h2i01j80di4xu0x0fet";

export const PRIVY_AUTH_ORIGIN = "https://auth.privy.io";

// Privy's OAuth surface for device-authorized agents. Wallet requests made with
// a device-code grant are scoped to the authorizing user's own wallets, so this
// path needs neither the app secret nor a backend proxy.
export const PRIVY_OAUTH_PATH = "/api/oauth/v2";
export const PRIVY_GRANT_TYPE_DEVICE_CODE = "device_code";

// Privy issues one embedded wallet per chain type, which is its name for what
// Space Object calls a network.
export const privyChainTypes = ["ethereum", "solana"] as const;
export const privyChainTypeSchema = z.enum(privyChainTypes);
export type PrivyChainType = z.infer<typeof privyChainTypeSchema>;

export const networkByPrivyChainType = {
  ethereum: "evm",
  solana: "svm",
} as const satisfies Record<PrivyChainType, Network>;

export const privyWalletSchema = z.object({
  id: z.string(),
  address: z.string(),
  // Privy supports chain types Space Object does not model, so this stays a
  // plain string and unsupported wallets drop out during mapping.
  chain_type: z.string(),
});

export type PrivyWallet = z.infer<typeof privyWalletSchema>;

// Returns null for chain types outside Space Object's domain, such as Privy's
// Tron or XRPL wallets.
export function toWallet(wallet: PrivyWallet): Wallet | null {
  const chainType = privyChainTypeSchema.safeParse(wallet.chain_type);
  if (!chainType.success) return null;

  return {
    id: wallet.id,
    address: wallet.address,
    network: networkByPrivyChainType[chainType.data],
  };
}
