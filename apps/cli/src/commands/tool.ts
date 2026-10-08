import type { ToolInspectOutput } from "@spaceobject/core";
import { UNSUPPORTED_TOOL_PRICE_TYPES } from "@spaceobject/core";
import pc from "picocolors";
import { z } from "zod";
import { zodCommand } from "zod-commander";
import { api, requestJson } from "../lib/api.ts";
import { displayUsd, runTool } from "../lib/tool.ts";
import { openSession, requireWallet } from "../lib/session.ts";
import { activeChain } from "../utils/chain.ts";
import { jsonStringSchema } from "../utils/json.ts";
import { err, fields, isJson, ok, shortAddress, success, truncate } from "../utils/result.ts";

// Discovery and inspection read the tool catalog through the Space Object API,
// which holds the provider's key; running pays straight from the wallet over
// x402 (lib/tool.ts).

const discover = zodCommand({
  name: "discover",
  description: "Search paid data tools, described in natural language",
  args: {
    query: z.string().describe("What you need, in natural language"),
  },
  opts: {
    limit: z.coerce.number().int().positive().max(40).prefault(20).describe("l;Maximum results"),
  },
  action: async (args, opts) => {
    const json = isJson(discover);

    const result = await requestJson(
      api.v1.tools.$get({ query: { q: args.query, limit: String(opts.limit) } }),
    ).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);
    if (result.tools.length === 0)
      return ok(
        pc.dim("No payable tools matched. Try describing the job differently."),
        result,
      )(json);

    const rows = result.tools.map((tool) => ({
      price: displayUsd(tool.price.amount.value),
      provider: tool.provider,
      endpoint: tool.endpoint,
      description: truncate(tool.description, 44),
    }));
    const width = {
      price: Math.max(...rows.map((row) => row.price.length)),
      provider: Math.max(...rows.map((row) => row.provider.length)),
      endpoint: Math.max(...rows.map((row) => row.endpoint.length)),
      description: Math.max(...rows.map((row) => row.description.length)),
    };

    ok(
      rows
        .map((row) =>
          [
            pc.dim(row.price.padEnd(width.price)),
            pc.cyan(row.provider.padEnd(width.provider)),
            pc.bold(row.endpoint.padEnd(width.endpoint)),
            row.description.padEnd(width.description),
          ].join("  "),
        )
        .join("\n"),
      result,
    )(json);
  },
});

const inspect = zodCommand({
  name: "inspect",
  description: "Show a tool's input schema, pricing and notes, without paying",
  opts: {
    provider: z.string().describe("p;Provider slug, e.g. apify"),
    endpoint: z.string().describe("e;Endpoint path, e.g. /apidojo/tweet-scraper"),
  },
  action: async (_args, opts) => {
    const json = isJson(inspect);

    const result = await requestJson(
      api.v1.tools.inspect.$post({ json: { provider: opts.provider, endpoint: opts.endpoint } }),
    ).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(inspectOutput(result), result)(json);
  },
});

function inspectOutput(tool: ToolInspectOutput): string {
  // The one parameter location an endpoint declares is the shape `tool run
  // --input` has to fill, so that is the schema printed.
  const schema = tool.input?.body ?? tool.input?.queryParams ?? tool.input?.pathParams ?? null;
  const metered =
    tool.price && UNSUPPORTED_TOOL_PRICE_TYPES.includes(tool.price.type)
      ? [
          "",
          pc.yellow(
            `This endpoint bills by ${tool.price.type.toLowerCase()} time, which x402 cannot prepay — it cannot be run here.`,
          ),
        ]
      : [];

  return [
    fields([
      [
        "Provider",
        pc.cyan(tool.providerName ? `${tool.provider} (${tool.providerName})` : tool.provider),
      ],
      ["Endpoint", pc.bold(tool.endpoint)],
      ["Method", tool.method ?? "GET"],
      [
        "Price",
        tool.price ? `${displayUsd(tool.price.amount.value)} · ${tool.price.type}` : "unknown",
      ],
      ...(tool.docUrl ? [["Docs", pc.cyan(tool.docUrl)] as [string, unknown]] : []),
    ]),
    "",
    tool.description,
    ...(tool.summary ? ["", pc.dim(truncate(tool.summary, 400))] : []),
    ...(schema
      ? [
          "",
          pc.dim(`Input (${tool.input?.bodyType ?? "schema"}):`),
          JSON.stringify(schema, null, 2),
        ]
      : ["", pc.dim("This endpoint takes no input.")]),
    ...(tool.notes && tool.notes.length > 0
      ? ["", pc.dim("Notes:"), ...tool.notes.map((note) => `  - ${note}`)]
      : []),
    ...metered,
  ].join("\n");
}

// Running is the only paying subcommand: the wallet settles the tool's 402
// Challenge on Monad, so every option either names the tool or bounds the
// payment.
const run = zodCommand({
  name: "run",
  description: "Run a tool, paying its 402 Challenge from the active wallet via x402",
  opts: {
    provider: z.string().describe("p;Provider slug, e.g. pdl"),
    endpoint: z.string().describe("e;Endpoint path, e.g. /person/enrich"),
    input: jsonStringSchema
      .pipe(z.record(z.string(), z.unknown()))
      .optional()
      .describe("i;Input as JSON, matching the shape `tool inspect` prints"),
    max: z.coerce.number().positive().optional().describe("Per-payment cap in USD; default $1"),
  },
  action: async (_args, opts) => {
    const json = isJson(run);

    const result = await runWithWallet({
      provider: opts.provider,
      endpoint: opts.endpoint,
      input: opts.input ?? {},
      maxUsd: opts.max,
    }).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    // The response body is the whole point of the run, so it owns stdout and
    // stays pipeable into jq. The payment notice goes to stderr, and a failing
    // status only sets the exit code.
    if (!json) process.stderr.write(`${receipt(result)}\n`);
    if (!result.ok) process.exitCode = 1;

    const payload = toRunPayload(result.body);
    ok(typeof payload === "string" ? result.body : "", { ...result, body: payload })(json);
  },
});

async function runWithWallet(opts: {
  provider: string;
  endpoint: string;
  input: unknown;
  maxUsd?: number;
}) {
  const session = await openSession();

  return runTool(session, requireWallet(session, activeChain), opts);
}

function receipt(result: Awaited<ReturnType<typeof runTool>>): string {
  const where = [
    `HTTP ${result.status}`,
    result.runStatus,
    result.runId ? `run ${shortAddress(result.runId)}` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  if (result.status === 202)
    return [
      pc.yellow("Run queued — this provider executes asynchronously."),
      pc.dim(`Retrieve it later from the same wallet: GET ${result.pollUrl ?? where}`),
    ].join("\n");

  if (!result.ok) return pc.red(`Run failed (${where}).`);

  const paid = result.price
    ? `Paid ${result.price} via x402 on Monad`
    : "Settled via x402 on Monad";
  return [success(paid), pc.dim(where)].join("\n");
}

/** The body a caller pipes into jq: parsed JSON when it is JSON, the raw text otherwise. */
function toRunPayload(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export const tool = zodCommand({
  name: "tool",
  description: "Discover and run paid data tools over x402",
})
  .addCommand(discover)
  .addCommand(inspect)
  .addCommand(run);
