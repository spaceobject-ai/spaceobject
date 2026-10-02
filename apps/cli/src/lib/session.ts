import { type Chain, networkByChain, type Wallet } from "@spaceobject/core";
import { getValidAccessToken } from "./credentials.ts";
import { decodeAccessTokenClaims } from "./jwt.ts";
import { openWalletSession, type WalletSession } from "./privy.ts";
import { CliError } from "../utils/errors.ts";

export async function requireAccessToken(): Promise<string> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new CliError("NOT_LOGGED_IN", "Not logged in.", "Run `sun auth login`.");

  return accessToken;
}

export async function openSession(): Promise<WalletSession> {
  return openWalletSession(await requireAccessToken());
}

export function requireWallet(session: WalletSession, chain: Chain): Wallet {
  const network = networkByChain[chain];
  const wallet = session.wallets.find((candidate) => candidate.network === network);
  if (!wallet)
    throw new CliError(
      "WALLET_NOT_FOUND",
      `This account has no ${network} embedded wallet.`,
      "Create one by signing in to the Space Object app, then run this command again.",
    );

  return wallet;
}

export async function requireUserId(): Promise<string> {
  return decodeAccessTokenClaims(await requireAccessToken()).sub;
}
