import { EVM_CHAIN_IDS, type Wallet } from "@spaceobject/core";
import { ClientEvmSigner, ExactEvmScheme } from "@x402/evm";
import {
  type PaymentRequirements,
  wrapFetchWithPayment,
  x402Client,
  x402HTTPClient,
} from "@x402/fetch";
import { z } from "zod";
import { CliError } from "../utils/errors.ts";
import type { WalletSession } from "./privy.ts";
import { toWalletAccount } from "./viem.ts";

// Tools are paid straight from the wallet over x402: the first POST answers
// with a 402 Challenge, the wallet signs it, and the retried request carries
// the payment. Discovery goes through the Space Object API instead, which
// holds the catalog provider's key. The x402 gateway below is Monid's — the
// catalog wired up today — and moves with the provider.
const X402_RUN_URL = "https://x402.monid.ai/v1/run";

// CAIP-2 name of the chain the CLI wallet pays from. The gateway also quotes
// runs on Base mainnet (eip155:8453); the scheme below is registered for Monad
// only, so those offers are refused rather than paid.
export const MONAD_NETWORK = `eip155:${EVM_CHAIN_IDS.monad}` as const;

export type RunOptions = {
  provider: string;
  endpoint: string;
  input: unknown;
  /** Per-payment USD cap on the wallet's USDC; undefined keeps the client's $1 default. */
  maxUsd?: number;
};

export type RunResult = {
  status: number;
  ok: boolean;
  body: string;
  runId: string | null;
  pollUrl: string | null;
  /** The run lifecycle status inside the body, e.g. COMPLETED — null when absent. */
  runStatus: string | null;
  /** The billed price in USD, already floored at the $0.01 minimum. */
  price: string | null;
};

/** The fields of a run-creation body the CLI reads; everything else passes through untouched. */
const runBodySchema = z.object({
  runId: z.string().optional(),
  pollUrl: z.string().optional(),
  status: z.string().optional(),
  hints: z.record(z.string(), z.unknown()).optional(),
  price: z.object({ amount: z.object({ value: z.number() }) }).optional(),
});

/**
 * POSTs the run to the provider's x402 gateway, settling the 402 Challenge
 * from the account's Monad wallet. Signs nothing when the tool is free or
 * refused.
 */
export async function runTool(
  session: WalletSession,
  wallet: Wallet,
  opts: RunOptions,
): Promise<RunResult> {
  const { fetchWithPayment, accepts } = paymentFetch(session, wallet, opts.maxUsd);

  const response = await fetchWithPayment(X402_RUN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: opts.provider, endpoint: opts.endpoint, input: opts.input }),
  }).catch((error: unknown) => rethrowPaymentFailure(accepts, error));

  const body = await response.text();
  // The body carries the run; parsing is best-effort because a refused request
  // answers with an error document instead.
  const data = toRunBody(body);

  return {
    status: response.status,
    ok: response.ok,
    body,
    runId: data?.runId ?? null,
    pollUrl: data?.pollUrl ?? toPollUrl(data?.hints) ?? (data?.runId ? runsUrl(data.runId) : null),
    runStatus: data?.status ?? null,
    price: data?.price ? displayUsd(data.price.amount.value) : null,
  };
}

/**
 * Builds the payment-aware fetch. Registering the scheme for Monad only means
 * a 402 quoting just another network has no payable option; the client refuses,
 * and rethrowPaymentFailure turns that into the reason.
 */
function paymentFetch(session: WalletSession, wallet: Wallet, maxUsd: number | undefined) {
  // A viem account signs the EIP-3009 authorization; that is the whole
  // ClientEvmSigner surface the exact scheme needs for an EIP-3009 asset.
  const signer = toWalletAccount(session, wallet) as ClientEvmSigner;
  const client = new x402Client().register(MONAD_NETWORK, new ExactEvmScheme(signer));
  // USDC on Monad is a default asset, so the client caps every payment at $1
  // unless the caller raises it with --max.
  if (maxUsd !== undefined) client.setSpendControls({ maxAmountPerPayment: `$${maxUsd}` });

  const http = new x402HTTPClient(client);
  const accepts: PaymentRequirements[] = [];
  // Captured before the client picks a Challenge, so a refusal can name the
  // networks the endpoint actually offered.
  http.onPaymentRequired(async ({ paymentRequired }) => {
    accepts.push(...paymentRequired.accepts);
  });

  return { fetchWithPayment: wrapFetchWithPayment(fetch, http), accepts };
}

function rethrowPaymentFailure(accepts: PaymentRequirements[], error: unknown): never {
  const networks = accepts.map((entry) => entry.network);
  if (accepts.length > 0 && !networks.includes(MONAD_NETWORK))
    throw new CliError(
      "TOOL_NETWORK_UNSUPPORTED",
      `The run was quoted on ${networks.join(", ")} only — the Space Object wallet pays on Monad (${MONAD_NETWORK}).`,
    );

  const message = error instanceof Error ? error.message : String(error);
  throw new CliError(
    "TOOL_PAYMENT_FAILED",
    `Could not pay for the run: ${message.split("\n")[0] ?? message}`,
    "Check the wallet holds USDC on Monad, or raise the per-payment cap with --max.",
  );
}

/** Catalog floor: a run quoted under $0.01 is billed, and shown, at $0.01. */
export function displayUsd(value: number): string {
  return `$${Math.max(value, 0.01)}`;
}

/** Reads the run fields out of a response body, tolerating non-JSON error documents. */
function toRunBody(body: string): z.infer<typeof runBodySchema> | null {
  try {
    const parsed = runBodySchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Async runs (202) carry the poll URL top-level or inside hints. */
function toPollUrl(hints: Record<string, unknown> | undefined): string | null {
  if (!hints) return null;
  const url = Object.values(hints).find(
    (value): value is string => typeof value === "string" && value.startsWith("https://"),
  );

  return url ?? null;
}

function runsUrl(runId: string) {
  return `${X402_RUN_URL.replace(/\/run$/, "/runs")}/${runId}`;
}
