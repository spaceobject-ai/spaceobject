import { type EvmChain, viemChainByChain, WRAPPED_NATIVE_TOKEN } from "@spaceobject/core";
import { weth9Abi } from "@spaceobject/core/abis/weth9";
import pc from "picocolors";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  type Hex,
  http,
} from "viem";
import { z } from "zod";
import { zodCommand } from "zod-commander";
import { openSession, requireWallet } from "../lib/session.ts";
import {
  formatTokenAmount,
  parseTokenAmount,
  readTokenMetadata,
  tokenLabel,
} from "../lib/token.ts";
import { toWalletAccount } from "../lib/viem.ts";
import { activeChain, chainDisplayName, networkDisplayName } from "../utils/chain.ts";
import { CliError } from "../utils/errors.ts";
import { jsonStringSchema } from "../utils/json.ts";
import { err, fields, isJson, ok, success } from "../utils/result.ts";

const evmSignMessage = zodCommand({
  name: "sign-message",
  description: "Sign a plaintext message with active EVM wallet",
  opts: {
    message: z.string().describe("m;The message to sign"),
  },
  action: async (_args, opts) => {
    const json = isJson(evmSignMessage);

    const result = await signMessage(activeChain, opts.message).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      fields([
        ["Address", pc.cyan(result.address)],
        ["Message", result.message],
        ["Signature", pc.cyan(result.signature)],
      ]),
      result,
    )(json);
  },
});

async function signMessage(chain: EvmChain, message: string) {
  const session = await openSession();
  const wallet = requireWallet(session, chain);

  return {
    address: wallet.address,
    message,
    signature: await toWalletAccount(session, wallet).signMessage({ message }),
  };
}

const typedDataSchema = z.object({
  domain: z.record(z.string(), z.unknown()).prefault({}),
  types: z.record(z.string(), z.unknown()),
  primaryType: z.string(),
  message: z.record(z.string(), z.unknown()),
});

const evmSignTypedData = zodCommand({
  name: "sign-typed-data",
  description: "Sign EIP-712 typed data with active EVM wallet",
  opts: {
    data: jsonStringSchema
      .pipe(typedDataSchema)
      .describe("d;EIP-712 payload as JSON: { domain, types, primaryType, message }"),
  },
  action: async (_args, opts) => {
    const json = isJson(evmSignTypedData);

    const result = await signTypedData(activeChain, opts.data).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      fields([
        ["Address", pc.cyan(result.address)],
        ["Type", result.primaryType],
        ["Signature", pc.cyan(result.signature)],
      ]),
      result,
    )(json);
  },
});

async function signTypedData(chain: EvmChain, typedData: z.infer<typeof typedDataSchema>) {
  const session = await openSession();
  const wallet = requireWallet(session, chain);

  return {
    address: wallet.address,
    primaryType: typedData.primaryType,
    // Privy validates the typed data itself; viem's generics are stricter than
    // anything that survives a round trip through JSON on the command line.
    signature: await toWalletAccount(session, wallet).signTypedData(typedData),
  };
}

const evmSendTx = zodCommand({
  name: "send-tx",
  description: "Sign and broadcast a transaction with active EVM wallet",
  opts: {
    to: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, "Expected a 0x-prefixed address")
      .describe("t;Recipient address"),
    value: z.coerce.bigint().optional().describe("v;Amount to send, in wei"),
    data: z
      .string()
      .regex(/^0x[0-9a-fA-F]*$/, "Expected 0x-prefixed hex")
      .optional()
      .describe("d;Calldata as 0x-prefixed hex"),
  },
  action: async (_args, opts) => {
    const json = isJson(evmSendTx);

    const result = await sendTransaction({ ...opts, chain: activeChain }).catch(
      (error: Error) => error,
    );
    if (result instanceof Error) return err(result)(json);

    ok(
      fields([
        ["Chain", pc.bold(chainDisplayName[result.chain])],
        ["From", pc.cyan(result.from)],
        ["To", pc.cyan(result.to)],
        ["Hash", pc.cyan(result.hash)],
      ]),
      result,
    )(json);
  },
});

async function sendTransaction(opts: {
  chain: EvmChain;
  to: string;
  value?: bigint;
  data?: string;
}) {
  const session = await openSession();
  const wallet = requireWallet(session, opts.chain);

  // viem prepares the transaction (nonce, gas, fees) and broadcasts it against
  // the chain's own RPC; Privy only produces the signature.
  const hash = await createWalletClient({
    account: toWalletAccount(session, wallet),
    chain: viemChainByChain[opts.chain],
    transport: http(),
  }).sendTransaction({
    to: opts.to as Hex,
    ...(opts.value !== undefined && { value: opts.value }),
    ...(opts.data && { data: opts.data as Hex }),
  });

  return { chain: opts.chain, from: wallet.address, to: opts.to, hash };
}

const address = zodCommand({
  name: "address",
  description: "Show wallet address",
  action: async () => {
    const json = isJson(address);

    const result = await listAddresses().catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      fields(
        result.wallets.map((wallet): [string, unknown] => [
          networkDisplayName[wallet.network],
          pc.cyan(wallet.address),
        ]),
      ),
      result,
    )(json);
  },
});

async function listAddresses() {
  const session = await openSession();

  // Privy also provisions an SVM embedded wallet, but the CLI is EVM-only for
  // now, so only EVM addresses are surfaced.
  return {
    wallets: session.wallets
      .filter((wallet) => wallet.network === "evm")
      .map((wallet) => ({
        network: wallet.network,
        address: wallet.address,
      })),
  };
}

const balance = zodCommand({
  name: "balance",
  description: "Show wallet's token balance",
  opts: {
    token: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, "Expected a 0x-prefixed address")
      .optional()
      .describe("t;ERC-20 token contract address; defaults to the chain's native token"),
  },
  action: async (_args, opts) => {
    const json = isJson(balance);

    const result = await (
      opts.token ? readTokenBalance(activeChain, opts.token) : readBalance(activeChain)
    ).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      fields([
        ["Chain", pc.bold(chainDisplayName[result.chain])],
        ["Address", pc.cyan(result.address)],
        ...(result.token ? [["Token", pc.cyan(result.token)] as [string, unknown]] : []),
        ["Balance", pc.bold(result.balance)],
      ]),
      result,
    )(json);
  },
});

async function readBalance(chain: EvmChain) {
  const session = await openSession();
  const wallet = requireWallet(session, chain);
  const config = viemChainByChain[chain];

  // A balance is a plain chain read, so it goes straight to the chain's RPC
  // rather than through Privy.
  const wei = await createPublicClient({ chain: config, transport: http() }).getBalance({
    address: wallet.address as Hex,
  });

  return {
    chain,
    address: wallet.address,
    balance: `${formatEther(wei)} ${config.nativeCurrency.symbol}`,
    // Present so the ternary in the action stays a proper union rather than
    // collapsing into the token-balance shape, which is otherwise a subtype.
    token: null,
  };
}

async function readTokenBalance(chain: EvmChain, token: string) {
  const session = await openSession();
  const wallet = requireWallet(session, chain);
  const client = createPublicClient({ chain: viemChainByChain[chain], transport: http() });

  const [wei, metadata] = await Promise.all([
    client.readContract({
      address: token as Hex,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet.address as Hex],
    }),
    readTokenMetadata(chain, token as Hex),
  ]);

  return {
    chain,
    address: wallet.address,
    token,
    balance: formatTokenAmount(wei, metadata),
  };
}

const transfer = zodCommand({
  name: "transfer",
  description: "Send native or ERC-20 tokens from the active wallet",
  args: {
    address: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, "Expected a 0x-prefixed address")
      .describe("Recipient address"),
    amount: z.string().describe("Amount to send in token units, e.g. 1.5"),
  },
  opts: {
    token: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, "Expected a 0x-prefixed address")
      .optional()
      .describe("t;ERC-20 token contract address; defaults to the chain's native token"),
    "as-unit": z.boolean().prefault(false).describe("Treat <amount> as raw base units"),
  },
  action: async (args, opts) => {
    const json = isJson(transfer);
    // commander camelCases --as-unit; zod-commander's opts type keeps the literal key.
    const asUnit = (opts as { asUnit?: boolean }).asUnit === true;

    const result = await transferTokens(
      activeChain,
      args.address,
      args.amount,
      opts.token,
      asUnit,
    ).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      [
        success(`Sent ${result.formatted}`),
        fields([
          ["Chain", pc.bold(chainDisplayName[result.chain])],
          ["From", pc.cyan(result.from)],
          ["To", pc.cyan(result.to)],
          ["Token", result.token ? tokenLabel(result.token, result.symbol) : "native"],
          ["Amount", `${result.formatted} ${pc.dim(`(${result.amount} base units)`)}`],
          ["Tx", pc.cyan(result.hash)],
        ]),
      ].join("\n"),
      result,
    )(json);
  },
});

async function transferTokens(
  chain: EvmChain,
  to: string,
  amount: string,
  token: string | undefined,
  asUnit: boolean,
) {
  const session = await openSession();
  const wallet = requireWallet(session, chain);
  const config = viemChainByChain[chain];
  const client = createPublicClient({ chain: config, transport: http() });
  const metadata = token
    ? await readTokenMetadata(chain, token as Hex)
    : { decimals: 18, symbol: config.nativeCurrency.symbol };
  if (token && !asUnit && !metadata)
    throw new CliError(
      "AMOUNT_INVALID",
      `Could not read the decimals of token ${token}.`,
      "Pass --as-unit with the amount in raw base units.",
    );

  const wei = parseTokenAmount(amount, asUnit, metadata?.decimals ?? 18, "AMOUNT_INVALID");
  const held = token
    ? await client.readContract({
        address: token as Hex,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet.address as Hex],
      })
    : await client.getBalance({ address: wallet.address as Hex });
  if (held < wei)
    throw new CliError(
      "AMOUNT_INVALID",
      `This wallet holds ${formatTokenAmount(held, metadata)} but tried to send ${formatTokenAmount(wei, metadata)}.`,
    );

  const walletClient = createWalletClient({
    account: toWalletAccount(session, wallet),
    chain: config,
    transport: http(),
  });
  const hash = token
    ? await walletClient.writeContract({
        address: token as Hex,
        abi: erc20Abi,
        functionName: "transfer",
        args: [to as Hex, wei],
      })
    : await walletClient.sendTransaction({ to: to as Hex, value: wei });
  await client.waitForTransactionReceipt({ hash });

  return {
    chain,
    from: wallet.address,
    to,
    token: token ?? null,
    symbol: metadata?.symbol ?? null,
    amount: wei.toString(),
    formatted: formatTokenAmount(wei, metadata),
    hash,
  };
}

const evmWrap = zodCommand({
  name: "wrap",
  description: "Wrap native tokens into the wrapped native token (WMON)",
  args: {
    amount: z.string().describe("Amount in native units, e.g. 1.5"),
  },
  opts: {
    "as-unit": z.boolean().prefault(false).describe("Treat <amount> as raw wei"),
  },
  action: async (args, opts) => {
    const json = isJson(evmWrap);
    // commander camelCases --as-unit; zod-commander's opts type keeps the literal key.
    const asUnit = (opts as { asUnit?: boolean }).asUnit === true;

    const result = await convertNative(activeChain, "wrap", args.amount, asUnit).catch(
      (error: Error) => error,
    );
    if (result instanceof Error) return err(result)(json);

    ok(wrapOutput("Wrapped", result), result)(json);
  },
});

const evmUnwrap = zodCommand({
  name: "unwrap",
  description: "Unwrap wrapped native tokens (WMON) back into native tokens",
  args: {
    amount: z.string().describe("Amount in native units, e.g. 1.5"),
  },
  opts: {
    "as-unit": z.boolean().prefault(false).describe("Treat <amount> as raw wei"),
  },
  action: async (args, opts) => {
    const json = isJson(evmUnwrap);
    // commander camelCases --as-unit; zod-commander's opts type keeps the literal key.
    const asUnit = (opts as { asUnit?: boolean }).asUnit === true;

    const result = await convertNative(activeChain, "unwrap", args.amount, asUnit).catch(
      (error: Error) => error,
    );
    if (result instanceof Error) return err(result)(json);

    ok(wrapOutput("Unwrapped", result), result)(json);
  },
});

async function convertNative(
  chain: EvmChain,
  direction: "wrap" | "unwrap",
  amount: string,
  asUnit: boolean,
) {
  const wei = parseTokenAmount(amount, asUnit, 18, "AMOUNT_INVALID");
  const session = await openSession();
  const wallet = requireWallet(session, chain);
  const token = WRAPPED_NATIVE_TOKEN[chain];
  const config = viemChainByChain[chain];
  const client = createPublicClient({ chain: config, transport: http() });
  const symbol = config.nativeCurrency.symbol;

  const held =
    direction === "wrap"
      ? await client.getBalance({ address: wallet.address as Hex })
      : await client.readContract({
          address: token,
          abi: weth9Abi,
          functionName: "balanceOf",
          args: [wallet.address as Hex],
        });
  if (held < wei)
    throw new CliError(
      "AMOUNT_INVALID",
      `This wallet holds ${formatEther(held)} ${direction === "wrap" ? symbol : `W${symbol}`} but tried to ${direction} ${formatEther(wei)}.`,
    );

  const walletClient = createWalletClient({
    account: toWalletAccount(session, wallet),
    chain: config,
    transport: http(),
  });
  const hash =
    direction === "wrap"
      ? await walletClient.writeContract({
          address: token,
          abi: weth9Abi,
          functionName: "deposit",
          value: wei,
        })
      : await walletClient.writeContract({
          address: token,
          abi: weth9Abi,
          functionName: "withdraw",
          args: [wei],
        });
  await client.waitForTransactionReceipt({ hash });

  return {
    chain,
    direction,
    address: wallet.address,
    token,
    symbol,
    amount: wei.toString(),
    formatted: formatEther(wei),
    hash,
  };
}

function wrapOutput(verb: string, result: Awaited<ReturnType<typeof convertNative>>): string {
  return [
    success(
      `${verb} ${result.formatted} ${result.direction === "wrap" ? result.symbol : `W${result.symbol}`}`,
    ),
    fields([
      ["Chain", pc.bold(chainDisplayName[result.chain])],
      ["Address", pc.cyan(result.address)],
      ["Token", pc.cyan(result.token)],
      ["Amount", `${result.formatted} ${pc.dim(`(${result.amount} wei)`)}`],
      ["Tx", pc.cyan(result.hash)],
    ]),
  ].join("\n");
}

const evm = zodCommand({
  name: "evm",
  description: "EVM wallet operations",
})
  .addCommand(evmSignMessage)
  .addCommand(evmSignTypedData)
  .addCommand(evmSendTx)
  .addCommand(evmWrap)
  .addCommand(evmUnwrap);

export const wallet = zodCommand({
  name: "wallet",
  description: "Operate the Privy embedded wallet for the authenticated account",
})
  .addCommand(address)
  .addCommand(balance)
  .addCommand(transfer)
  .addCommand(evm);
