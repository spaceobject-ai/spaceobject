import pc from "picocolors";
import { z } from "zod";
import { zodCommand } from "zod-commander";
import { api, requestJson } from "../lib/api.ts";
import { callTool, displayUsd } from "../lib/tool.ts";
import { openSession, requireWallet } from "../lib/session.ts";
import { activeChain } from "../utils/chain.ts";
import { CliError } from "../utils/errors.ts";
import { jsonStringSchema } from "../utils/json.ts";
import { err, isJson, ok, success, truncate } from "../utils/result.ts";

// Discovery reads the tool catalog through the Space Object API, which holds
// the provider's key; calling pays straight from the wallet over x402
// (lib/tool.ts).

const discover = zodCommand({
  name: "discover",
  description: "Search paid data tools, described in natural language",
  args: {
    query: z.string().describe("What you need, in natural language"),
  },
  opts: {
    limit: z.coerce.number().int().positive().max(20).prefault(20).describe("l;Maximum results"),
  },
  action: async (args, opts) => {
    const json = isJson(discover);

    const result = await requestJson(
      api.v1.tools.$get({ query: { q: args.query, limit: String(opts.limit) } }),
    ).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);
    if (result.length === 0)
      return ok(
        pc.dim("No payable tools matched. Try describing the job differently."),
        result,
      )(json);

    const rows = result.map((tool) => ({
      price: displayUsd(tool.price),
      id: tool.id,
      description: truncate(tool.description, 44),
    }));
    const width = {
      price: Math.max(...rows.map((row) => row.price.length)),
      id: Math.max(...rows.map((row) => row.id.length)),
      description: Math.max(...rows.map((row) => row.description.length)),
    };

    ok(
      rows
        .map((row) =>
          [
            pc.dim(row.price.padEnd(width.price)),
            pc.bold(row.id.padEnd(width.id)),
            row.description.padEnd(width.description),
          ].join("  "),
        )
        .join("\n"),
      result,
    )(json);
  },
});

// Calling is the only paying subcommand: the wallet settles the tool's 402
// Challenge on Monad, so every option either names the tool or bounds the
// payment.
const call = zodCommand({
  name: "call",
  description: "Call a tool, paying its 402 Challenge from the active wallet via x402",
  args: {
    tool: z.string().describe("Tool id from `tool discover`, e.g. pdl/person/enrich"),
  },
  opts: {
    input: jsonStringSchema
      .pipe(z.record(z.string(), z.unknown()))
      .optional()
      .describe("i;Input as JSON, matching the input schema `tool discover` prints"),
    max: z.coerce.number().positive().optional().describe("Per-payment cap in USD; default $1"),
  },
  action: async (args, opts) => {
    const json = isJson(call);

    const target = splitToolId(args.tool);
    if (!target)
      return err(
        new CliError(
          "TOOL_ID_INVALID",
          `Not a tool id: ${args.tool}. Expected <provider><endpoint>, e.g. pdl/person/enrich.`,
        ),
      )(json);

    const result = await callWithWallet({
      provider: target.provider,
      endpoint: target.endpoint,
      input: opts.input ?? {},
      maxUsd: opts.max,
    }).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    // The response body is the whole point of the call, so it owns stdout and
    // stays pipeable into jq; the payment notice goes to stderr either way. A
    // failing provider status only sets the exit code.
    process.stderr.write(`${receipt(result)}\n`);
    if (!result.ok) {
      process.exitCode = 1;
      return ok(result.body, { success: false, error: callError(result) })(json);
    }

    const payload = toCallPayload(result.body);
    ok(result.body, { success: true, data: payload })(json);
  },
});

/**
 * A tool id is `${provider}${endpoint}`: provider slugs carry no slash and
 * endpoints begin with one, so the first slash marks the boundary.
 */
function splitToolId(id: string): { provider: string; endpoint: string } | null {
  const index = id.indexOf("/");
  if (index <= 0) return null;

  return { provider: id.slice(0, index), endpoint: id.slice(index) };
}

async function callWithWallet(opts: {
  provider: string;
  endpoint: string;
  input: unknown;
  maxUsd?: number;
}) {
  const session = await openSession();

  return callTool(session, requireWallet(session, activeChain), opts);
}

function receipt(result: Awaited<ReturnType<typeof callTool>>): string {
  if (!result.ok) return pc.red(`Call failed (HTTP ${result.status}).`);

  const paid = result.price
    ? `Paid ${result.price} via x402 on Monad`
    : "Settled via x402 on Monad";
  // An async run answers 202 with a poll URL: the payment settled, the result
  // comes from a later signed GET (monid.ai/docs/guide/pay-with-x402).
  const note = result.pollUrl
    ? pc.dim(
        `HTTP 202 — run accepted; retrieve the result from ${result.pollUrl} with the same wallet`,
      )
    : pc.dim(`HTTP ${result.status}`);
  return [success(paid), note].join("\n");
}

/** The failed-call error text: the provider's body says why when it speaks. */
function callError(result: Awaited<ReturnType<typeof callTool>>): string {
  const reason = result.body.trim();

  return reason !== "" ? reason : `The provider answered HTTP ${result.status}.`;
}

/** The body a caller pipes into jq: parsed JSON when it is JSON, the raw text otherwise. */
function toCallPayload(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export const tool = zodCommand({
  name: "tool",
  description: "Discover and call paid data tools over x402",
})
  .addCommand(discover)
  .addCommand(call);
