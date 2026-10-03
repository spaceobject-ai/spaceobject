import {
  agenticCommerceByChain,
  type EvmChain,
  viemChainByChain,
  type Wallet,
  WRAPPED_NATIVE_TOKEN,
} from "@spaceobject/core";
import { erc8183AgenticCommerceAbi } from "@spaceobject/core/abis/erc8183";
import pc from "picocolors";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  isAddress,
  parseEventLogs,
  stringToHex,
  zeroAddress,
  zeroHash,
} from "viem";
import { z } from "zod";
import { zodCommand } from "zod-commander";
import { api, requestJson, requireOnchainAgentId } from "../lib/api.ts";
import type { WalletSession } from "../lib/privy.ts";
import { openSession, requireWallet } from "../lib/session.ts";
import {
  formatTokenAmount,
  parseTokenAmount,
  readTokenMetadata,
  tokenLabel,
  type TokenMetadata,
} from "../lib/token.ts";
import { toWalletAccount } from "../lib/viem.ts";
import { activeChain } from "../utils/chain.ts";
import { CliError } from "../utils/errors.ts";
import {
  err,
  fields,
  formatRelative,
  formatTimestamp,
  isJson,
  ok,
  shortAddress,
  success,
  truncate,
} from "../utils/result.ts";

// Contract enum order; jobStatuses[status] converts a getJob status to a name.
const jobStatuses = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;

// API filter values; BUDGET_SET is an OPEN job whose provider priced it.
const jobStatusFilters = [
  "OPEN",
  "BUDGET_SET",
  "FUNDED",
  "SUBMITTED",
  "COMPLETED",
  "REJECTED",
  "EXPIRED",
] as const;

const list = zodCommand({
  name: "list",
  description: "List ACP jobs this account created, or jobs assigned to its agents",
  opts: {
    assigned: z
      .boolean()
      .prefault(false)
      .describe("a;List jobs created for your agents instead of jobs you created"),
    "agent-id": z
      .string()
      .optional()
      .describe("Only jobs assigned to this onchain agent id (requires --assigned)"),
    status: z.enum(jobStatusFilters).optional().describe("s;Filter by job status"),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(1000)
      .prefault(20)
      .describe("l;Maximum results per page"),
    skip: z.coerce.number().int().nonnegative().prefault(0).describe("Number of results to skip"),
  },
  action: async (_args, opts) => {
    const json = isJson(list);
    // commander camelCases --agent-id; zod-commander's opts type keeps the literal key.
    const agentId = (opts as { agentId?: string }).agentId;

    const result = await listJobs({
      assigned: opts.assigned,
      agentId,
      status: opts.status,
      limit: opts.limit,
      skip: opts.skip,
    }).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);
    if (result.jobs.length === 0)
      return ok(
        pc.dim(
          result.assigned ? "No jobs assigned to your agents." : "No jobs created by this wallet.",
        ),
        result,
      )(json);

    ok(
      [
        ...(await jobLines(result.jobs, result.assigned)),
        ...(result.jobs.length === opts.limit
          ? ["", pc.dim(`More results may exist — re-run with --skip ${opts.skip + opts.limit}.`)]
          : []),
      ].join("\n"),
      result,
    )(json);
  },
});

async function listJobs(opts: {
  assigned: boolean;
  agentId?: string;
  status?: (typeof jobStatusFilters)[number];
  limit: number;
  skip: number;
}) {
  if (opts.agentId !== undefined && !opts.assigned)
    throw new CliError("FLAG_CONFLICT", "--agent-id only filters assigned jobs; add --assigned.");

  const address = requireWallet(await openSession(), activeChain).address;
  const jobs = await requestJson(
    api.v1.jobs.$get({
      query: {
        ...(opts.assigned ? { provider: address } : { client: address }),
        ...(opts.agentId !== undefined && { agentId: requireOnchainAgentId(opts.agentId) }),
        ...(opts.status && { status: opts.status }),
        limit: String(opts.limit),
        skip: String(opts.skip),
      },
    }),
  );

  return { address, assigned: opts.assigned, jobs };
}

type JobSummary = Awaited<ReturnType<typeof listJobs>>["jobs"][number];

async function jobLines(jobs: JobSummary[], assigned: boolean): Promise<string[]> {
  const metadata = await readBudgetTokens(jobs);
  const rows = jobs.map((job) => ({
    id: `#${job.id}`,
    status: job.status,
    description: truncate(job.description, 44),
    budget: job.budget
      ? formatTokenAmount(BigInt(job.budget.amount), metadata[job.budget.token] ?? null)
      : "—",
    meta: jobMeta(job, assigned),
  }));
  const width = {
    id: Math.max(...rows.map((row) => row.id.length)),
    status: Math.max(...rows.map((row) => row.status.length)),
    description: Math.max(...rows.map((row) => row.description.length)),
    budget: Math.max(...rows.map((row) => row.budget.length)),
  };

  return rows.map((row) =>
    [
      pc.cyan(row.id.padEnd(width.id)),
      statusLabel(row.status, width.status),
      row.description.padEnd(width.description),
      pc.bold(row.budget.padStart(width.budget)),
      pc.dim(row.meta),
    ].join("  "),
  );
}

// One metadata read per distinct budget token; the cache makes repeats free.
async function readBudgetTokens(jobs: JobSummary[]): Promise<Record<string, TokenMetadata | null>> {
  const tokens = [...new Set(jobs.flatMap((job) => (job.budget ? [job.budget.token] : [])))];
  return Object.fromEntries(
    await Promise.all(
      tokens.map(
        async (token) => [token, await readTokenMetadata(activeChain, token as Address)] as const,
      ),
    ),
  );
}

function jobMeta(job: JobSummary, assigned: boolean): string {
  const settled =
    job.status === "COMPLETED" || job.status === "REJECTED" || job.status === "EXPIRED";
  return [
    counterparty(job, assigned),
    ...(settled ? [] : [`expires ${formatRelative(job.expiresAt)}`]),
  ].join(" · ");
}

function statusLabel(status: string, width: number): string {
  const padded = status.padEnd(width);
  if (status === "COMPLETED") return pc.green(padded);
  if (status === "REJECTED" || status === "EXPIRED") return pc.red(padded);
  if (status === "SUBMITTED") return pc.yellow(padded);
  if (status === "BUDGET_SET") return pc.magenta(padded);
  return pc.cyan(padded);
}

function counterparty(job: JobSummary, assigned: boolean): string {
  if (assigned)
    return `from ${shortAddress(job.client)}${job.assignedAgent ? ` for agent #${job.assignedAgent.id}` : ""}`;
  if (job.assignedAgent) return `agent #${job.assignedAgent.id}`;
  if (job.provider) return `provider ${shortAddress(job.provider)}`;
  return "unassigned";
}

const create = zodCommand({
  name: "create",
  description: "Create an ACP job for an onchain agent, with this wallet as client and evaluator",
  args: {
    description: z.string().min(1).describe("Job description"),
  },
  opts: {
    "agent-id": z.string().describe("Onchain agent id of the provider agent"),
    "expires-in": z
      .string()
      .regex(/^\d+[smhd]$/, "Use a number with a unit: 30m, 12h, 7d")
      .prefault("7d")
      .describe("Time until the job expires, e.g. 12h or 7d"),
  },
  action: async (args, opts) => {
    const json = isJson(create);
    const { agentId, expiresIn } = opts as unknown as { agentId: string; expiresIn: string };

    const result = await createJob(activeChain, args.description, agentId, expiresIn, json).catch(
      (error: Error) => error,
    );
    if (result instanceof Error) return err(result)(json);

    ok(
      [
        success("Job created"),
        fields([
          ["Job ID", pc.cyan(`#${result.jobId}`)],
          ["Description", truncate(result.description, 60)],
          ["Provider", `${result.provider} ${pc.dim(`(${result.agentName} #${result.agentId})`)}`],
          ["Evaluator", `${result.evaluator} ${pc.dim("(you)")}`],
          [
            "Expires",
            `${formatTimestamp(result.expiresAt * 1000)} ${pc.dim(`(${formatRelative(result.expiresAt * 1000)})`)}`,
          ],
          ["Tx", pc.cyan(result.txHash)],
        ]),
        "",
        pc.dim(`Next: the provider prices it — sun agent job set-budget ${result.jobId} <budget>`),
      ].join("\n"),
      result,
    )(json);
  },
});

async function createJob(
  chain: EvmChain,
  description: string,
  agentId: string,
  expiresIn: string,
  json: boolean,
) {
  const agent = await requestJson(
    api.v1.agents[":agentId"].$get({ param: { agentId: requireOnchainAgentId(agentId) } }),
    new CliError(
      "AGENT_NOT_FOUND",
      `No onchain agent with id ${agentId}.`,
      "Run `sun agent discover <query>` to find onchain agents.",
    ),
  );

  // The provider is the wallet the agent advertises for jobs; agents without
  // an agentWallet metadata entry are paid at their owner address.
  const agentWallet = agent.metadata["agentWallet"];
  const provider =
    typeof agentWallet === "string" && isAddress(agentWallet) ? agentWallet : agent.owner;
  if (!isAddress(provider))
    throw new CliError("JOB_ACTION_FAILED", `Agent #${agentId} has no valid provider address.`);

  const session = await openSession();
  const wallet = requireWallet(session, chain);
  if (provider.toLowerCase() === wallet.address.toLowerCase())
    throw new CliError(
      "JOB_ACTION_FAILED",
      "This wallet provides for that agent — a job's client cannot also be its provider.",
    );

  const expiresAt = Math.floor(Date.now() / 1000) + parseDuration(expiresIn);

  progress(json, `Creating job for agent #${agentId}…`);
  const txHash = await walletClient(chain, session, wallet)
    .writeContract({
      address: agenticCommerceByChain[chain],
      abi: erc8183AgenticCommerceAbi,
      functionName: "createJob",
      args: [
        provider,
        wallet.address as Address,
        expiresAt,
        description,
        zeroAddress,
        BigInt(agentId),
      ],
    })
    .catch(rethrowRevert("create the job"));
  const receipt = await publicClient(chain).waitForTransactionReceipt({ hash: txHash });

  const jobId = parseEventLogs({
    abi: erc8183AgenticCommerceAbi,
    logs: receipt.logs,
    eventName: "JobCreated",
  })[0]?.args.jobId;
  if (jobId === undefined)
    throw new CliError(
      "JOB_ACTION_FAILED",
      "The createJob transaction confirmed but emitted no JobCreated event.",
      `Inspect transaction ${txHash}, then check \`sun agent job list\`.`,
    );

  return {
    chain,
    jobId: jobId.toString(),
    agentId,
    agentName: agent.name,
    description,
    client: wallet.address,
    provider,
    evaluator: wallet.address,
    expiresAt,
    txHash,
  };
}

function parseDuration(value: string): number {
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match)
    throw new CliError("JOB_INPUT_INVALID", `${value} is not a duration. Use e.g. 30m, 12h, 7d.`);
  const units = { s: 1, m: 60, h: 3600, d: 86400 } as const;
  return Number(match[1]) * units[match[2] as keyof typeof units];
}

const setBudget = zodCommand({
  name: "set-budget",
  description: "Set a job's price as its provider",
  args: {
    jobId: z.string().describe("Onchain job id"),
    budget: z.string().describe("Budget in token units, or raw base units with --as-unit"),
  },
  opts: {
    token: z
      .string()
      .optional()
      .describe("t;Payment token address (must be whitelisted); omit for wrapped native (WMON)"),
    "as-unit": z.boolean().prefault(false).describe("Treat <budget> as raw base units"),
  },
  action: async (args, opts) => {
    const json = isJson(setBudget);
    // commander camelCases --as-unit; zod-commander's opts type keeps the literal key.
    const asUnit = (opts as { asUnit?: boolean }).asUnit === true;

    const result = await setJobBudget(
      activeChain,
      args.jobId,
      args.budget,
      { token: opts.token, unit: asUnit },
      json,
    ).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      [
        success("Budget set"),
        fields([
          ["Job ID", pc.cyan(`#${result.jobId}`)],
          ["Budget", `${pc.bold(result.budget)} ${pc.dim(`(${result.amount} base units)`)}`],
          ["Token", tokenLabel(result.token, result.symbol)],
          ["Tx", pc.cyan(result.txHash)],
        ]),
        "",
        pc.dim(`Next: the client escrows it — sun agent job fund ${result.jobId}`),
      ].join("\n"),
      result,
    )(json);
  },
});

async function setJobBudget(
  chain: EvmChain,
  jobId: string,
  budget: string,
  opts: { token?: string; unit: boolean },
  json: boolean,
) {
  const token = resolveToken(chain, opts.token);
  const allowed = await publicClient(chain).readContract({
    address: agenticCommerceByChain[chain],
    abi: erc8183AgenticCommerceAbi,
    functionName: "allowedPaymentTokens",
    args: [token],
  });
  if (!allowed)
    throw new CliError(
      "JOB_ACTION_FAILED",
      `Token ${token} is not whitelisted by the escrow contract.`,
      "Pass a whitelisted token with --token <address>.",
    );

  const metadata = await readTokenMetadata(chain, token);
  if (!opts.unit && !metadata)
    throw new CliError(
      "JOB_ACTION_FAILED",
      `Could not read the decimals of token ${token}.`,
      "Pass --as-unit with the amount in raw base units.",
    );
  const amount = parseTokenAmount(budget, opts.unit, metadata?.decimals ?? 0, "JOB_INPUT_INVALID");

  progress(json, `Setting budget on job #${jobId}…`);
  const txHash = await walletClient(chain, await openSession())
    .writeContract({
      address: agenticCommerceByChain[chain],
      abi: erc8183AgenticCommerceAbi,
      functionName: "setBudget",
      args: [requireJobId(jobId), token, amount, "0x"],
    })
    .catch(rethrowRevert("set the budget"));
  await publicClient(chain).waitForTransactionReceipt({ hash: txHash });

  return {
    chain,
    jobId,
    token,
    symbol: metadata?.symbol ?? null,
    amount: amount.toString(),
    budget: formatTokenAmount(amount, metadata),
    txHash,
  };
}

function resolveToken(chain: EvmChain, token: string | undefined): Address {
  if (token === undefined) return WRAPPED_NATIVE_TOKEN[chain];
  if (!isAddress(token))
    throw new CliError("JOB_INPUT_INVALID", `${token} is not a token address.`);
  return token;
}

const fund = zodCommand({
  name: "fund",
  description: "Escrow a job's budget as its client",
  args: {
    jobId: z.string().describe("Onchain job id"),
  },
  action: async (args) => {
    const json = isJson(fund);

    const result = await fundJob(activeChain, args.jobId, json).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      [
        success("Job funded"),
        fields([
          ["Job ID", pc.cyan(`#${result.jobId}`)],
          ["Escrowed", `${pc.bold(result.budget)} ${pc.dim(`(${result.amount} base units)`)}`],
          ["Token", tokenLabel(result.token, result.symbol)],
          ...(result.approveTxHash
            ? [["Approve Tx", pc.cyan(result.approveTxHash)] as [string, unknown]]
            : []),
          ["Fund Tx", pc.cyan(result.txHash)],
        ]),
        "",
        pc.dim("Next: the provider works and delivers — sun agent job deliver <jobId> <fileHash>"),
      ].join("\n"),
      result,
    )(json);
  },
});

async function fundJob(chain: EvmChain, jobId: string, json: boolean) {
  const id = requireJobId(jobId);
  const job = await readJob(chain, id);
  if (jobStatuses[job.status] !== "OPEN")
    throw new CliError(
      "JOB_ACTION_FAILED",
      `Job #${jobId} is ${jobStatuses[job.status]}; only open jobs can be funded.`,
    );
  if (job.budget === 0n)
    throw new CliError(
      "JOB_ACTION_FAILED",
      `Job #${jobId} has no budget yet.`,
      `The provider sets it first: sun agent job set-budget ${jobId} <budget>`,
    );

  const session = await openSession();
  const wallet = requireWallet(session, chain);
  const escrow = agenticCommerceByChain[chain];
  const metadata =
    job.paymentToken === zeroAddress ? null : await readTokenMetadata(chain, job.paymentToken);

  // The escrow pulls ERC-20 budgets via transferFrom, so the client must hold
  // and approve the amount before fund() can succeed.
  const approveTxHash =
    job.paymentToken === zeroAddress
      ? null
      : await approveBudget(chain, session, wallet, job.paymentToken, job.budget, metadata, json);

  progress(json, `Funding job #${jobId} with ${formatTokenAmount(job.budget, metadata)}…`);
  const txHash = await walletClient(chain, session, wallet)
    .writeContract({
      address: escrow,
      abi: erc8183AgenticCommerceAbi,
      functionName: "fund",
      args: [id, job.paymentToken, job.budget, "0x"],
    })
    .catch(rethrowRevert("fund the job"));
  await publicClient(chain).waitForTransactionReceipt({ hash: txHash });

  return {
    chain,
    jobId,
    token: job.paymentToken,
    symbol: metadata?.symbol ?? null,
    amount: job.budget.toString(),
    budget: formatTokenAmount(job.budget, metadata),
    approveTxHash,
    txHash,
  };
}

async function approveBudget(
  chain: EvmChain,
  session: WalletSession,
  wallet: Wallet,
  token: Address,
  budget: bigint,
  metadata: TokenMetadata | null,
  json: boolean,
) {
  const escrow = agenticCommerceByChain[chain];
  const address = wallet.address as Address;
  const [balance, allowance] = await Promise.all([
    publicClient(chain).readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }),
    publicClient(chain).readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, escrow],
    }),
  ]);
  if (balance < budget)
    throw new CliError(
      "JOB_ACTION_FAILED",
      `This wallet holds ${formatTokenAmount(balance, metadata)} but the budget is ${formatTokenAmount(budget, metadata)}.`,
      metadata?.symbol === "WMON"
        ? "Wrap more native tokens with `sun wallet evm wrap <amount>`."
        : undefined,
    );
  if (allowance >= budget) return null;

  progress(json, `Approving ${formatTokenAmount(budget, metadata)} for the escrow…`);
  const txHash = await walletClient(chain, session, wallet)
    .writeContract({
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [escrow, budget],
    })
    .catch(rethrowRevert("approve the budget"));
  await publicClient(chain).waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

const deliver = zodCommand({
  name: "deliver",
  description: "Submit a deliverable for a funded job as its provider",
  args: {
    jobId: z.string().describe("Onchain job id"),
    fileHash: z
      .string()
      .describe("sha2-256 of the deliverable, as printed by `sun storage upload`"),
  },
  action: async (args) => {
    const json = isJson(deliver);

    const result = await deliverJob(activeChain, args.jobId, args.fileHash, json).catch(
      (error: Error) => error,
    );
    if (result instanceof Error) return err(result)(json);

    ok(
      [
        success("Deliverable submitted"),
        fields([
          ["Job ID", pc.cyan(`#${result.jobId}`)],
          ["Deliverable", pc.cyan(result.deliverable)],
          ["Tx", pc.cyan(result.txHash)],
        ]),
        "",
        pc.dim(
          `Next: the client evaluates it — sun agent job complete ${result.jobId} (or reject)`,
        ),
      ].join("\n"),
      result,
    )(json);
  },
});

async function deliverJob(chain: EvmChain, jobId: string, fileHash: string, json: boolean) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(fileHash))
    throw new CliError(
      "JOB_INPUT_INVALID",
      `${fileHash} is not a 32-byte hash.`,
      "Pass the sha2-256 of the deliverable, e.g. the hash `sun storage upload` printed.",
    );

  progress(json, `Submitting deliverable for job #${jobId}…`);
  const txHash = await walletClient(chain, await openSession())
    .writeContract({
      address: agenticCommerceByChain[chain],
      abi: erc8183AgenticCommerceAbi,
      functionName: "submit",
      args: [requireJobId(jobId), fileHash as `0x${string}`, "0x"],
    })
    .catch(rethrowRevert("submit the deliverable"));
  await publicClient(chain).waitForTransactionReceipt({ hash: txHash });

  return { chain, jobId, deliverable: fileHash, txHash };
}

const complete = zodCommand({
  name: "complete",
  description: "Mark a submitted job as completed, releasing escrow to the provider",
  args: {
    jobId: z.string().describe("Onchain job id"),
  },
  opts: {
    reason: z.string().optional().describe("r;Completion reason (32 bytes max)"),
  },
  action: async (args, opts) => {
    const json = isJson(complete);

    const result = await evaluateJob(activeChain, "complete", args.jobId, opts.reason, json).catch(
      (error: Error) => error,
    );
    if (result instanceof Error) return err(result)(json);

    ok(
      [
        success("Job completed"),
        fields([
          ["Job ID", pc.cyan(`#${result.jobId}`)],
          ...(result.reason ? [["Reason", result.reason] as [string, unknown]] : []),
          ["Tx", pc.cyan(result.txHash)],
        ]),
        "",
        pc.dim("Escrow released to the provider."),
      ].join("\n"),
      result,
    )(json);
  },
});

const reject = zodCommand({
  name: "reject",
  description: "Reject a job as its client or evaluator, refunding any escrow",
  args: {
    jobId: z.string().describe("Onchain job id"),
  },
  opts: {
    reason: z.string().optional().describe("r;Rejection reason (32 bytes max)"),
  },
  action: async (args, opts) => {
    const json = isJson(reject);

    const result = await evaluateJob(activeChain, "reject", args.jobId, opts.reason, json).catch(
      (error: Error) => error,
    );
    if (result instanceof Error) return err(result)(json);

    ok(
      [
        success("Job rejected"),
        fields([
          ["Job ID", pc.cyan(`#${result.jobId}`)],
          ...(result.reason ? [["Reason", result.reason] as [string, unknown]] : []),
          ["Tx", pc.cyan(result.txHash)],
        ]),
        "",
        pc.dim("Any escrow was refunded to the client."),
      ].join("\n"),
      result,
    )(json);
  },
});

async function evaluateJob(
  chain: EvmChain,
  action: "complete" | "reject",
  jobId: string,
  reason: string | undefined,
  json: boolean,
) {
  progress(json, `Marking job #${jobId} as ${action === "complete" ? "completed" : "rejected"}…`);
  const txHash = await walletClient(chain, await openSession())
    .writeContract({
      address: agenticCommerceByChain[chain],
      abi: erc8183AgenticCommerceAbi,
      functionName: action,
      args: [requireJobId(jobId), toReason(reason), "0x"],
    })
    .catch(rethrowRevert(`${action} the job`));
  await publicClient(chain).waitForTransactionReceipt({ hash: txHash });

  return { chain, jobId, action, reason: reason ?? null, txHash };
}

function toReason(reason: string | undefined): `0x${string}` {
  if (reason === undefined) return zeroHash;
  if (Buffer.byteLength(reason) > 32)
    throw new CliError(
      "JOB_INPUT_INVALID",
      "The reason must fit in 32 bytes.",
      "Pass a short tag, or the hash of a longer document.",
    );
  return stringToHex(reason, { size: 32 });
}

const refund = zodCommand({
  name: "refund",
  description: "Reclaim the escrow of an expired job back to its client",
  args: {
    jobId: z.string().describe("Onchain job id"),
  },
  action: async (args) => {
    const json = isJson(refund);

    const result = await refundJob(activeChain, args.jobId, json).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      [
        success("Refund claimed"),
        fields([
          ["Job ID", pc.cyan(`#${result.jobId}`)],
          ["Refunded", `${pc.bold(result.budget)} ${pc.dim(`(${result.amount} base units)`)}`],
          ["Tx", pc.cyan(result.txHash)],
        ]),
      ].join("\n"),
      result,
    )(json);
  },
});

async function refundJob(chain: EvmChain, jobId: string, json: boolean) {
  const id = requireJobId(jobId);
  const job = await readJob(chain, id);
  const status = jobStatuses[job.status];
  if (status !== "FUNDED" && status !== "SUBMITTED")
    throw new CliError(
      "JOB_ACTION_FAILED",
      `Job #${jobId} is ${status}; only funded or submitted jobs hold escrow to refund.`,
    );

  const metadata =
    job.paymentToken === zeroAddress ? null : await readTokenMetadata(chain, job.paymentToken);

  progress(json, `Claiming refund for job #${jobId}…`);
  const txHash = await walletClient(chain, await openSession())
    .writeContract({
      address: agenticCommerceByChain[chain],
      abi: erc8183AgenticCommerceAbi,
      functionName: "claimRefund",
      args: [id],
    })
    .catch(rethrowRevert("claim the refund"));
  await publicClient(chain).waitForTransactionReceipt({ hash: txHash });

  return {
    chain,
    jobId,
    amount: job.budget.toString(),
    budget: formatTokenAmount(job.budget, metadata),
    txHash,
  };
}

function requireJobId(value: string): bigint {
  if (!/^\d+$/.test(value))
    throw new CliError("JOB_INPUT_INVALID", `${value} is not an onchain job id.`);
  return BigInt(value);
}

async function readJob(chain: EvmChain, jobId: bigint) {
  const job = await publicClient(chain).readContract({
    address: agenticCommerceByChain[chain],
    abi: erc8183AgenticCommerceAbi,
    functionName: "getJob",
    args: [jobId],
  });
  if (job.client === zeroAddress)
    throw new CliError(
      "JOB_NOT_FOUND",
      `No onchain job with id ${jobId}.`,
      "Run `sun agent job list` to see this account's jobs.",
    );

  return job;
}

function publicClient(chain: EvmChain) {
  return createPublicClient({ chain: viemChainByChain[chain], transport: http() });
}

function walletClient(
  chain: EvmChain,
  session: WalletSession,
  wallet: Wallet = requireWallet(session, chain),
) {
  return createWalletClient({
    account: toWalletAccount(session, wallet),
    chain: viemChainByChain[chain],
    transport: http(),
  });
}

// The ABI lets viem decode custom errors on gas estimation, so failed
// preconditions surface before any transaction is sent.
const revertReasons = {
  WrongStatus: "the job's status does not allow this action",
  Unauthorized: "the active wallet may not perform this action on this job",
  InvalidJob: "no job exists with that id",
  PaymentTokenNotAllowed: "that payment token is not whitelisted by the escrow contract",
  PaymentTokenMismatch: "the token does not match the job's payment token",
  BudgetMismatch: "the budget changed onchain since it was read; re-run the command",
  UnexpectedFundedAmount: "the funded amount did not match the budget",
  ClientCannotBeProvider: "a job's client cannot also be its provider",
  ProviderCannotBeEvaluator: "a job's provider cannot also be its evaluator",
  ProviderNotSet: "the job has no provider yet",
  ExpiryTooShort: "the expiry is too soon; pick a longer --expires-in",
  GracePeriodActive: "the evaluation grace period has not passed yet",
  EnforcedPause: "the escrow contract is paused",
  ZeroAddress: "an address argument was zero",
} as const;

function rethrowRevert(action: string) {
  return (error: unknown): never => {
    const message = error instanceof Error ? error.message : String(error);
    const reason = Object.entries(revertReasons).find(([name]) => message.includes(name))?.[1];
    const short =
      (error as { shortMessage?: string }).shortMessage ?? message.split("\n")[0] ?? message;
    throw new CliError("JOB_ACTION_FAILED", `Could not ${action}: ${reason ?? short}.`);
  };
}

function progress(json: boolean, message: string) {
  // Progress goes to stderr so stdout stays parseable in both output modes.
  if (!json) process.stderr.write(pc.dim(`${message}\n`));
}

export const job = zodCommand({
  name: "job",
  description: "Create, work, and settle ACP jobs with onchain agents",
})
  .addCommand(list)
  .addCommand(create)
  .addCommand(setBudget)
  .addCommand(fund)
  .addCommand(deliver)
  .addCommand(complete)
  .addCommand(reject)
  .addCommand(refund);
