import crypto from "node:crypto";
import {
  PRIVY_APP_ID,
  PRIVY_AUTH_ORIGIN,
  PRIVY_GRANT_TYPE_DEVICE_CODE,
  PRIVY_OAUTH_PATH,
  privyWalletSchema,
  toWallet,
} from "@spaceobject/core";
import canonicalize from "canonicalize";
import { z } from "zod";
import { CliError } from "../utils/errors.ts";
import { createRecipientKeyPair, openSealed } from "./hpke.ts";

const deviceAuthorizationSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  verification_uri_complete: z.string(),
  expires_in: z.number(),
  interval: z.number(),
});

const tokensSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
});

export type Tokens = z.infer<typeof tokensSchema>;

const headers = {
  "Content-Type": "application/json",
  "privy-app-id": PRIVY_APP_ID,
};

export async function requestDeviceAuthorization() {
  const res = await fetch(`${PRIVY_AUTH_ORIGIN}/api/oauth/v2/device_authorization`, {
    method: "POST",
    headers,
    body: "{}",
  });

  if (res.status === 403)
    throw new CliError(
      "DEVICE_AUTH_DISABLED",
      "Device authorization is not enabled for this Privy app.",
      "Enable CLI and agent access in the Privy dashboard.",
    );
  if (!res.ok)
    throw new CliError(
      "DEVICE_AUTH_FAILED",
      `Device authorization failed: HTTP ${res.status}`,
      "Check your network, then run `sun auth login` again.",
    );

  return deviceAuthorizationSchema.parse(await res.json());
}

export async function pollForTokens(deviceCode: string, intervalSeconds: number): Promise<Tokens> {
  let delay = intervalSeconds * 1000;

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, delay));

    const result = await exchangeDeviceCode(deviceCode);
    if (result.tokens) return result.tokens;

    if (result.error === "authorization_pending") continue;
    if (result.error === "slow_down") {
      delay += 5000;
      continue;
    }

    throw toTokenError(result);
  }
}

// One-shot exchange for `auth login --complete`; unlike pollForTokens, a
// pending authorization is an error the user can retry after approving.
export async function completeDeviceAuthorization(deviceCode: string): Promise<Tokens> {
  const result = await exchangeDeviceCode(deviceCode);
  if (result.tokens) return result.tokens;

  if (result.error === "authorization_pending" || result.error === "slow_down")
    throw new CliError(
      "AUTH_PENDING",
      "Authorization is still pending.",
      "Approve the login in your browser, then run this command again.",
    );

  throw toTokenError(result);
}

type ExchangeResult =
  | { tokens: Tokens; error?: never; status?: never }
  | { tokens?: never; error: string | undefined; status: number };

async function exchangeDeviceCode(deviceCode: string): Promise<ExchangeResult> {
  const res = await fetch(`${PRIVY_AUTH_ORIGIN}/api/oauth/v2/token`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
    }),
  });

  if (res.ok) return { tokens: tokensSchema.parse(await res.json()) };

  const error = await res
    .json()
    .then((body) => z.object({ error: z.string() }).parse(body).error)
    .catch(() => undefined);

  return { error, status: res.status };
}

function toTokenError(result: { error?: string; status: number }): Error {
  if (result.error === "expired_token")
    return new CliError(
      "DEVICE_CODE_EXPIRED",
      "The device code expired.",
      "Run `sun auth login` to get a new code.",
    );
  if (result.error === "access_denied")
    return new CliError(
      "AUTH_DENIED",
      "Authorization was denied in the browser.",
      "Run `sun auth login` again and approve it in the browser.",
    );

  return new CliError(
    "TOKEN_REQUEST_FAILED",
    `Token request failed: HTTP ${result.status}`,
    "Run the command again, or start over with `sun auth login`.",
  );
}

export async function refreshTokens(refreshToken: string): Promise<Tokens> {
  const res = await fetch(`${PRIVY_AUTH_ORIGIN}/api/oauth/v2/token`, {
    method: "POST",
    headers,
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });

  if (!res.ok)
    throw new CliError(
      "SESSION_EXPIRED",
      "Session expired or revoked.",
      "Run `sun auth login` to log in again.",
    );

  return tokensSchema.parse(await res.json());
}

const authenticateWalletsSchema = z.object({
  encrypted_authorization_key: z.object({
    encapsulated_key: z.string(),
    ciphertext: z.string(),
  }),
  wallets: z.array(privyWalletSchema),
});

// The authorization key grants direct signing authority over the user's wallets
// for up to 15 minutes, so it is minted per process and never written to disk.
// Each CLI invocation pays one extra round trip in exchange for that.
export async function openWalletSession(accessToken: string) {
  const recipient = createRecipientKeyPair();
  const res = await fetch(`${PRIVY_AUTH_ORIGIN}${PRIVY_OAUTH_PATH}/wallets/authenticate`, {
    method: "POST",
    headers: walletHeaders(accessToken),
    body: JSON.stringify({
      encryption_type: "HPKE",
      recipient_public_key: recipient.publicKeySpki,
    }),
  });

  if (res.status === 401)
    throw new CliError(
      "SESSION_EXPIRED",
      "Session expired or revoked.",
      "Run `sun auth login` to log in again.",
    );
  if (!res.ok)
    throw new CliError(
      "WALLET_AUTH_FAILED",
      `Wallet authorization failed: HTTP ${res.status}`,
      "Run the command again, or start over with `sun auth login`.",
    );

  const body = authenticateWalletsSchema.parse(await res.json());
  return {
    accessToken,
    authorizationKey: await openSealed(recipient.privateKeyPem, {
      encapsulatedKey: body.encrypted_authorization_key.encapsulated_key,
      ciphertext: body.encrypted_authorization_key.ciphertext,
    }),
    wallets: body.wallets.map(toWallet).filter((wallet) => wallet !== null),
  };
}

export type WalletSession = Awaited<ReturnType<typeof openWalletSession>>;

// Privy's RPC responses wrap the result in `data`; callers pick the field their
// method returns.
export const walletSignatureSchema = z.object({ data: z.object({ signature: z.string() }) });
export const walletSignedTransactionSchema = z.object({
  data: z.object({ signed_transaction: z.string() }),
});

export async function walletRpc(session: WalletSession, walletId: string, body: object) {
  const url = `${PRIVY_AUTH_ORIGIN}${PRIVY_OAUTH_PATH}/wallets/${walletId}/rpc`;
  // BigInts (EIP-3009 authorization values, chain ids) have no JSON form; EIP-712
  // integers are read back as decimal strings, so the values sign identically.
  // Round-trip through JSON so the signed payload and the transmitted bytes agree
  // on how absent fields are dropped.
  const payload = JSON.parse(toJson(body));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...walletHeaders(session.accessToken),
      "privy-authorization-signature": authorizationSignature(
        session.authorizationKey,
        url,
        payload,
      ),
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 403)
    throw new CliError(
      "WALLET_NOT_ACCESSIBLE",
      "That wallet does not belong to the authenticated account.",
      "Run `sun auth whoami` to check who is logged in.",
    );
  if (!res.ok)
    throw new CliError(
      "WALLET_RPC_FAILED",
      `Wallet request failed: HTTP ${res.status} ${await res.text()}`,
      "Run the command again, or start over with `sun auth login`.",
    );

  return res.json();
}

function toJson(body: object) {
  return JSON.stringify(body, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

// Proves to Privy that the wallet owner authorized this exact request. The
// payload is canonicalized per RFC 8785 and signed with ECDSA P-256.
export function authorizationSignature(authorizationKey: string, url: string, body: unknown) {
  const payload = canonicalize({
    version: 1,
    method: "POST",
    url,
    body,
    headers: { "privy-app-id": PRIVY_APP_ID },
  });

  const privateKey = authorizationKey.startsWith("-----BEGIN")
    ? crypto.createPrivateKey(authorizationKey)
    : crypto.createPrivateKey({
        key: Buffer.from(authorizationKey, "base64"),
        format: "der",
        type: "pkcs8",
      });

  return crypto.sign("sha256", Buffer.from(payload ?? ""), privateKey).toString("base64");
}

function walletHeaders(accessToken: string) {
  return {
    ...headers,
    "privy-grant-type": PRIVY_GRANT_TYPE_DEVICE_CODE,
    Authorization: `Bearer ${accessToken}`,
  };
}
