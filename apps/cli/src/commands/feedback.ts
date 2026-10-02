import {
  agenticCommerceByChain,
  type EvmChain,
  reputationRegistryByChain,
  viemChainByChain,
  type Wallet,
} from "@spaceobject/core";
import { erc8004ReputationRegistryAbi } from "@spaceobject/core/abis/erc8004";
import { erc8183AgenticCommerceAbi } from "@spaceobject/core/abis/erc8183";
import pc from "picocolors";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  parseEventLogs,
  zeroAddress,
} from "viem";
import { z } from "zod";
import { zodCommand } from "zod-commander";
import { api, requestJson, requireOnchainAgentId } from "../lib/api.ts";
import {
  emptyFeedbackUri,
  formatScore,
  resolveFeedbackDocument,
  toFeedbackUri,
} from "../lib/feedback.ts";
import type { WalletSession } from "../lib/privy.ts";
import { openSession, requireWallet } from "../lib/session.ts";
import { toWalletAccount } from "../lib/viem.ts";
import { activeChain, chainDisplayName } from "../utils/chain.ts";
import { CliError } from "../utils/errors.ts";
import { jsonStringSchema } from "../utils/json.ts";
import { err, fields, formatRelative, isJson, ok, shortAddress, success } from "../utils/result.ts";

const give = zodCommand({
  name: "give",
  description: "Give onchain ERC-8004 feedback to an ACP agent, as this wallet",
  args: {
    agentId: z.string().describe("Onchain agent id"),
  },
  opts: {
    score: z.coerce.number().int().min(0).max(100).describe("s;Score from 0 (worst) to 100 (best)"),
    tag1: z.string().optional().describe("Primary tag, e.g. quality"),
    tag2: z.string().optional().describe("Secondary tag"),
    endpoint: z.string().optional().describe("e;Service endpoint the feedback concerns"),
    job: z
      .string()
      .optional()
      .describe("j;Settled onchain job this feedback follows; validates this wallet as its client"),
    data: jsonStringSchema
      .optional()
      .describe("Feedback document as a JSON string, e.g. a comment"),
    file: z.string().optional().describe("f;Path to a feedback document JSON file"),
    "dry-run": z
      .boolean()
      .prefault(false)
      .describe("Show what give would do without sending a transaction"),
  },
  action: async (args, opts) => {
    const json = isJson(give);
    // commander camelCases --dry-run; zod-commander's opts type keeps the literal key.
    const dryRun = (opts as { dryRun?: boolean }).dryRun === true;

    const result = await giveFeedback(activeChain, args.agentId, { ...opts, dryRun }, json).catch(
      (error: Error) => error,
    );
    if (result instanceof Error) return err(result)(json);

    if (result.dryRun)
      return ok(
        fields([
          ["Agent", `${pc.bold(result.agentName)} ${pc.dim(`(#${result.agentId})`)}`],
          ["Chain", pc.bold(chainDisplayName[result.chain])],
          ["Wallet", pc.cyan(result.client)],
          ["Registry", result.registry],
          ["Score", `★ ${formatScore(result.score)}`],
          ["Tags", tagsLabel(result.tag1, result.tag2)],
          ...(result.endpoint ? [["Endpoint", result.endpoint] as [string, unknown]] : []),
          ...(result.jobId ? [["Job", `#${result.jobId}`] as [string, unknown]] : []),
          [
            "Feedback URI",
            result.uri === "" ? pc.dim("none — score only") : `${result.uri.length} bytes`,
          ],
        ]),
        result,
      )(json);

    ok(
      [
        success("Feedback given"),
        fields([
          ["Agent", `${pc.bold(result.agentName)} ${pc.dim(`(#${result.agentId})`)}`],
          ["Score", `★ ${formatScore(result.score)}`],
          ["Tags", tagsLabel(result.tag1, result.tag2)],
          ...(result.jobId ? [["Job", `#${result.jobId}`] as [string, unknown]] : []),
          ["Feedback Index", `#${result.feedbackIndex}`],
          ["Tx", pc.cyan(result.txHash)],
        ]),
        "",
        pc.dim(`Run \`sun agent feedback list ${result.agentId}\` to see it once indexed.`),
      ].join("\n"),
      result,
    )(json);
  },
});

async function giveFeedback(
  chain: EvmChain,
  agentId: string,
  opts: {
    score: number;
    tag1?: string;
    tag2?: string;
    endpoint?: string;
    job?: string;
    data?: unknown;
    file?: string;
    dryRun: boolean;
  },
  json: boolean,
) {
  const agent = await requestJson(
    api.v1.agents[":agentId"].$get({ param: { agentId: requireOnchainAgentId(agentId) } }),
    agentNotFound(agentId),
  );

  const session = await openSession();
  const wallet = requireWallet(session, chain);
  if (agent.owner.toLowerCase() === wallet.address.toLowerCase())
    throw new CliError(
      "FEEDBACK_ACTION_FAILED",
      `This wallet owns agent #${agentId} — feedback must come from a client.`,
    );

  if (opts.job !== undefined) await requireSettledJobAsClient(chain, opts.job, agentId, wallet);

  // The job id lands inside the document so feedback stays traceable to the
  // work it rates; an explicit jobId in --data/--file stays authoritative.
  const provided = await resolveFeedbackDocument(opts);
  const document =
    provided === null && opts.job === undefined
      ? null
      : { ...(opts.job && { jobId: opts.job }), ...provided };
  const { uri, hash } = document === null ? emptyFeedbackUri : toFeedbackUri(document);

  const shared = {
    chain,
    agentId,
    agentName: agent.name,
    client: wallet.address,
    registry: reputationRegistryByChain[chain],
    score: opts.score,
    tag1: opts.tag1 ?? null,
    tag2: opts.tag2 ?? null,
    endpoint: opts.endpoint ?? null,
    jobId: opts.job ?? null,
    uri,
    hash,
  };
  if (opts.dryRun) return { dryRun: true as const, ...shared };

  progress(json, `Giving feedback to agent #${agentId}…`);
  const txHash = await walletClient(chain, session, wallet)
    .writeContract({
      address: reputationRegistryByChain[chain],
      abi: erc8004ReputationRegistryAbi,
      functionName: "giveFeedback",
      args: [
        BigInt(agentId),
        BigInt(opts.score),
        0,
        opts.tag1 ?? "",
        opts.tag2 ?? "",
        opts.endpoint ?? "",
        uri,
        hash,
      ],
    })
    .catch(rethrowRevert("give the feedback"));
  const receipt = await publicClient(chain).waitForTransactionReceipt({ hash: txHash });

  const feedbackIndex = parseEventLogs({
    abi: erc8004ReputationRegistryAbi,
    logs: receipt.logs,
    eventName: "NewFeedback",
  })[0]?.args.feedbackIndex;
  if (feedbackIndex === undefined)
    throw new CliError(
      "FEEDBACK_ACTION_FAILED",
      "The giveFeedback transaction confirmed but emitted no NewFeedback event.",
      `Inspect transaction ${txHash}, then check \`sun agent feedback list ${agentId}\`.`,
    );

  return { dryRun: false as const, ...shared, feedbackIndex: Number(feedbackIndex), txHash };
}

// Feedback tied to a job must come from that job's client, target the job's
// provider agent, and follow settlement — expiry counts as settled because
// the contract never stores the EXPIRED status.
async function requireSettledJobAsClient(
  chain: EvmChain,
  jobId: string,
  agentId: string,
  wallet: Wallet,
) {
  if (!/^\d+$/.test(jobId))
    throw new CliError("FEEDBACK_INPUT_INVALID", `${jobId} is not an onchain job id.`);

  const job = await publicClient(chain).readContract({
    address: agenticCommerceByChain[chain],
    abi: erc8183AgenticCommerceAbi,
    functionName: "getJob",
    args: [BigInt(jobId)],
  });
  if (job.client === zeroAddress)
    throw new CliError("JOB_NOT_FOUND", `No onchain job with id ${jobId}.`);
  if (job.client.toLowerCase() !== wallet.address.toLowerCase())
    throw new CliError(
      "FEEDBACK_ACTION_FAILED",
      `Job #${jobId} was created by ${job.client}, not this wallet.`,
      "Only a job's client can attach feedback to it.",
    );
  if (job.providerAgentId !== BigInt(agentId))
    throw new CliError(
      "FEEDBACK_ACTION_FAILED",
      `Job #${jobId} was assigned to agent #${job.providerAgentId}, not #${agentId}.`,
    );

  // Contract enum order: OPEN, FUNDED, SUBMITTED, COMPLETED, REJECTED.
  const settled = job.status === 3 || job.status === 4 || job.expiredAt * 1000 < Date.now();
  if (!settled)
    throw new CliError(
      "FEEDBACK_ACTION_FAILED",
      `Job #${jobId} is not settled yet.`,
      `Complete or reject it first: sun agent job complete ${jobId}`,
    );
}

function tagsLabel(tag1: string | null, tag2: string | null): string {
  const tags = [tag1, tag2].filter((tag) => tag !== null && tag !== "");
  return tags.length > 0 ? tags.join(" · ") : pc.dim("none");
}

const list = zodCommand({
  name: "list",
  description: "List feedback left for an onchain ACP agent",
  args: {
    agentId: z.string().describe("Onchain agent id"),
  },
  opts: {
    client: z.string().optional().describe("c;Only feedback left by this client address"),
    tag: z.string().optional().describe("t;Only feedback carrying this tag (tag1 or tag2)"),
    "include-revoked": z.boolean().prefault(false).describe("Include revoked feedback entries"),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(1000)
      .prefault(20)
      .describe("l;Maximum results per page"),
    skip: z.coerce.number().int().nonnegative().prefault(0).describe("Number of results to skip"),
  },
  action: async (args, opts) => {
    const json = isJson(list);
    // commander camelCases --include-revoked; zod-commander's opts type keeps the literal key.
    const includeRevoked = (opts as { includeRevoked?: boolean }).includeRevoked === true;

    const result = await listFeedbacks(args.agentId, {
      client: opts.client,
      tag: opts.tag,
      includeRevoked,
      limit: opts.limit,
      skip: opts.skip,
    }).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);
    if (result.feedbacks.length === 0)
      return ok(
        pc.dim(
          result.client || result.tag
            ? "No feedback matched. Try removing filters."
            : `No feedback yet for agent #${result.agentId}.`,
        ),
        result,
      )(json);

    const rows = result.feedbacks.map((entry) => ({
      score: `★ ${formatScore(entry.score)}`,
      tags: tagsLabel(entry.tag1 || null, entry.tag2 || null),
      from: `${shortAddress(entry.client)} #${entry.feedbackIndex}`,
      time: formatRelative(entry.createdAt),
      revoked: entry.revoked,
    }));
    const width = {
      score: Math.max(...rows.map((row) => row.score.length)),
      tags: Math.max(...rows.map((row) => row.tags.length)),
      from: Math.max(...rows.map((row) => row.from.length)),
    };

    ok(
      [
        ...rows.map((row) =>
          [
            pc.bold(row.score.padEnd(width.score)),
            row.tags.padEnd(width.tags),
            pc.cyan(row.from.padEnd(width.from)),
            pc.dim(row.time),
            ...(row.revoked ? [pc.yellow("revoked")] : []),
          ].join("  "),
        ),
        "",
        pc.dim("Reference entries as <client> #<feedbackIndex> in revoke and respond."),
        ...(result.feedbacks.length === opts.limit
          ? [pc.dim(`More results may exist — re-run with --skip ${opts.skip + opts.limit}.`)]
          : []),
      ].join("\n"),
      result,
    )(json);
  },
});

async function listFeedbacks(
  agentId: string,
  opts: { client?: string; tag?: string; includeRevoked: boolean; limit: number; skip: number },
) {
  const client = opts.client === undefined ? undefined : requireClientAddress(opts.client);
  const feedbacks = await requestJson(
    api.v1.agents[":agentId"].feedbacks.$get({
      param: { agentId: requireOnchainAgentId(agentId) },
      query: {
        ...(client && { client }),
        ...(opts.tag && { tag: opts.tag }),
        includeRevoked: String(opts.includeRevoked),
        limit: String(opts.limit),
        skip: String(opts.skip),
      },
    }),
    agentNotFound(agentId),
  );

  return {
    agentId,
    client: client ?? null,
    tag: opts.tag ?? null,
    includeRevoked: opts.includeRevoked,
    limit: opts.limit,
    skip: opts.skip,
    feedbacks,
  };
}

const revoke = zodCommand({
  name: "revoke",
  description: "Revoke feedback this wallet gave to an onchain ACP agent",
  args: {
    agentId: z.string().describe("Onchain agent id"),
    feedbackIndex: z.coerce
      .number()
      .int()
      .positive()
      .describe("Per-client feedback index from `sun agent feedback list`"),
  },
  action: async (args) => {
    const json = isJson(revoke);

    const result = await revokeFeedback(activeChain, args.agentId, args.feedbackIndex, json).catch(
      (error: Error) => error,
    );
    if (result instanceof Error) return err(result)(json);

    ok(
      [
        success("Feedback revoked"),
        fields([
          ["Agent", pc.cyan(`#${result.agentId}`)],
          ["Feedback Index", `#${result.feedbackIndex}`],
          ["Tx", pc.cyan(result.txHash)],
        ]),
        "",
        pc.dim("The entry stays onchain but is excluded from listings and reputation."),
      ].join("\n"),
      result,
    )(json);
  },
});

async function revokeFeedback(chain: EvmChain, agentId: string, index: number, json: boolean) {
  const id = BigInt(requireOnchainAgentId(agentId));
  const session = await openSession();
  const wallet = requireWallet(session, chain);

  const existing = await requireFeedback(chain, id, wallet.address as Address, BigInt(index));
  if (existing.isRevoked)
    throw new CliError(
      "FEEDBACK_ACTION_FAILED",
      `Feedback #${index} on agent #${agentId} is already revoked.`,
    );

  progress(json, `Revoking feedback #${index} on agent #${agentId}…`);
  const txHash = await walletClient(chain, session, wallet)
    .writeContract({
      address: reputationRegistryByChain[chain],
      abi: erc8004ReputationRegistryAbi,
      functionName: "revokeFeedback",
      args: [id, BigInt(index)],
    })
    .catch(rethrowRevert("revoke the feedback"));
  await publicClient(chain).waitForTransactionReceipt({ hash: txHash });

  return { chain, agentId, feedbackIndex: index, client: wallet.address, txHash };
}

const respond = zodCommand({
  name: "respond",
  description: "Append a response to feedback on an onchain ACP agent, e.g. as its owner",
  args: {
    agentId: z.string().describe("Onchain agent id"),
    client: z.string().describe("Client address that gave the feedback"),
    feedbackIndex: z.coerce
      .number()
      .int()
      .positive()
      .describe("Per-client feedback index from `sun agent feedback list`"),
  },
  opts: {
    data: jsonStringSchema.optional().describe("d;Response document as a JSON string"),
    file: z.string().optional().describe("f;Path to a response document JSON file"),
  },
  action: async (args, opts) => {
    const json = isJson(respond);

    const result = await respondToFeedback(
      activeChain,
      args.agentId,
      args.client,
      args.feedbackIndex,
      opts,
      json,
    ).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      [
        success("Response appended"),
        fields([
          ["Agent", pc.cyan(`#${result.agentId}`)],
          ["Feedback", `${shortAddress(result.client)} #${result.feedbackIndex}`],
          ["Response URI", `${result.uri.length} bytes`],
          ["Tx", pc.cyan(result.txHash)],
        ]),
      ].join("\n"),
      result,
    )(json);
  },
});

async function respondToFeedback(
  chain: EvmChain,
  agentId: string,
  client: string,
  index: number,
  opts: { data?: unknown; file?: string },
  json: boolean,
) {
  const id = BigInt(requireOnchainAgentId(agentId));
  const address = requireClientAddress(client);

  const document = await resolveFeedbackDocument(opts);
  if (document === null)
    throw new CliError(
      "FLAG_MISSING",
      "Provide the response document via --data or --file.",
      'e.g. --data \'{"comment":"We shipped a fix."}\'',
    );
  const { uri, hash } = toFeedbackUri(document);

  await requireFeedback(chain, id, address, BigInt(index));

  progress(json, `Responding to feedback #${index} on agent #${agentId}…`);
  const txHash = await walletClient(chain, await openSession())
    .writeContract({
      address: reputationRegistryByChain[chain],
      abi: erc8004ReputationRegistryAbi,
      functionName: "appendResponse",
      args: [id, address, BigInt(index), uri, hash],
    })
    .catch(rethrowRevert("respond to the feedback"));
  await publicClient(chain).waitForTransactionReceipt({ hash: txHash });

  return { chain, agentId, client: address, feedbackIndex: index, uri, hash, txHash };
}

// Feedback indexes are 1-based per client; getLastIndex returns 0 when the
// client never gave feedback. Checking upfront turns opaque reverts into
// actionable errors.
async function requireFeedback(chain: EvmChain, agentId: bigint, client: Address, index: bigint) {
  const lastIndex = await publicClient(chain).readContract({
    address: reputationRegistryByChain[chain],
    abi: erc8004ReputationRegistryAbi,
    functionName: "getLastIndex",
    args: [agentId, client],
  });
  if (index > lastIndex)
    throw new CliError(
      "FEEDBACK_INPUT_INVALID",
      lastIndex === 0n
        ? `${client} has given agent #${agentId} no feedback.`
        : `${client} has feedback indexes 1 to ${lastIndex} on agent #${agentId}, not ${index}.`,
      `Run \`sun agent feedback list ${agentId}\` to see feedback indexes.`,
    );

  const [, , , , isRevoked] = await publicClient(chain).readContract({
    address: reputationRegistryByChain[chain],
    abi: erc8004ReputationRegistryAbi,
    functionName: "readFeedback",
    args: [agentId, client, index],
  });
  return { isRevoked };
}

function requireClientAddress(value: string): Address {
  if (!isAddress(value))
    throw new CliError("FEEDBACK_INPUT_INVALID", `${value} is not an EVM address.`);
  return value;
}

function agentNotFound(agentId: string): CliError {
  return new CliError(
    "AGENT_NOT_FOUND",
    `No onchain agent with id ${agentId}.`,
    "Run `sun agent discover <query>` to find onchain agents.",
  );
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

// The reputation registry reverts with require strings rather than custom
// errors, so surface viem's short message as-is.
function rethrowRevert(action: string) {
  return (error: unknown): never => {
    const message = error instanceof Error ? error.message : String(error);
    const short =
      (error as { shortMessage?: string }).shortMessage ?? message.split("\n")[0] ?? message;
    throw new CliError("FEEDBACK_ACTION_FAILED", `Could not ${action}: ${short}`);
  };
}

function progress(json: boolean, message: string) {
  // Progress goes to stderr so stdout stays parseable in both output modes.
  if (!json) process.stderr.write(pc.dim(`${message}\n`));
}

export const feedback = zodCommand({
  name: "feedback",
  description: "Give, list, revoke, and respond to ERC-8004 feedback on onchain ACP agents",
})
  .addCommand(give)
  .addCommand(list)
  .addCommand(revoke)
  .addCommand(respond);
