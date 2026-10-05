import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { zeroAddress, isAddressEqual } from "viem";
import { problemDetailsResponse } from "hono-problem-details/openapi";
import { problemDetails } from "hono-problem-details";

import { Job_Filter, JobStatus, JobSummaryFragment } from "../lib/mesh/__generated/sdk";
import { Env } from "../env";
import { parseTimestamp } from "../utils/timestamp";
import {
  getJobOutputSchema,
  getJobParamsSchema,
  listJobsOutputSchema,
  listJobsQuerySchema,
} from "../schemas/jobs";

// The escrow only flips a job to EXPIRED when someone calls claimRefund, so a
// job past its deadline can still read OPEN, FUNDED, or SUBMITTED on-chain.
// Derive the effective status from expiresAt instead of trusting the stored
// one. SUBMITTED jobs get the contract's evaluation grace period, during which
// the evaluator can still complete them. OPEN jobs with a priced budget are
// surfaced as BUDGET_SET so clients know the job is ready to fund.
const EVALUATION_GRACE_PERIOD_SECONDS = 3600;

type EffectiveStatus = JobStatus | "BUDGET_SET";

const effectiveStatus = (job: JobSummaryFragment, nowSeconds: number): EffectiveStatus => {
  const expiresAt = Number(job.expiresAt);
  if ((job.status === "OPEN" || job.status === "FUNDED") && expiresAt <= nowSeconds)
    return "EXPIRED";
  if (job.status === "SUBMITTED" && expiresAt + EVALUATION_GRACE_PERIOD_SECONDS <= nowSeconds)
    return "EXPIRED";
  if (job.status === "OPEN" && job.paymentToken) return "BUDGET_SET";
  return job.status;
};

// Branches to `or` together for a status filter, mirroring effectiveStatus.
const statusFilters = (status: EffectiveStatus, nowSeconds: number): Job_Filter[] => {
  const now = String(nowSeconds);
  const graceCutoff = String(nowSeconds - EVALUATION_GRACE_PERIOD_SECONDS);
  if (status === "EXPIRED")
    return [
      { status: "EXPIRED" },
      { status_in: ["OPEN", "FUNDED"], expiresAt_lte: now },
      { status: "SUBMITTED", expiresAt_lte: graceCutoff },
    ];
  if (status === "OPEN") return [{ status, expiresAt_gt: now, paymentToken: null }];
  if (status === "BUDGET_SET")
    return [{ status: "OPEN", expiresAt_gt: now, paymentToken_not: null }];
  if (status === "FUNDED") return [{ status, expiresAt_gt: now }];
  if (status === "SUBMITTED") return [{ status, expiresAt_gt: graceCutoff }];
  return [{ status }];
};

const toJobSummary = (job: JobSummaryFragment, nowSeconds: number) => ({
  id: job.jobId,
  status: effectiveStatus(job, nowSeconds),
  client: job.client.address,
  provider: job.provider?.address ?? null,
  evaluator: job.evaluator.address,
  assignedAgent: job.assignedAgent
    ? {
        id: job.assignedAgent.id,
        name: job.assignedAgent.registration?.name ?? null,
        image: job.assignedAgent.registration?.image ?? null,
      }
    : null,
  description: job.description,
  deliverable: job.deliverable,
  completionReason: job.completionReason,
  rejectionReason: job.rejectionReason,
  budget: job.paymentToken ? { amount: job.budget, token: job.paymentToken } : null,
  expiresAt: parseTimestamp(job.expiresAt),
  createdAt: parseTimestamp(job.createdAt),
  updatedAt: parseTimestamp(job.updatedAt),
  activities: job.activities.map((activity) => ({
    kind: activity.kind,
    address: activity.actor?.address ?? null,
    amount: activity.amount ?? null,
    timestamp: parseTimestamp(activity.timestamp),
    txHash: activity.txHash,
  })),
});

export const listJobsRoute = createRoute({
  method: "get",
  path: "/",
  request: {
    query: listJobsQuerySchema,
  },
  responses: {
    200: {
      description: "Jobs found",
      content: {
        "application/json": {
          schema: listJobsOutputSchema,
        },
      },
    },
  },
});

export const getJobRoute = createRoute({
  method: "get",
  path: "/{jobId}",
  request: {
    params: getJobParamsSchema,
  },
  responses: {
    200: {
      description: "Job found",
      content: {
        "application/json": {
          schema: getJobOutputSchema,
        },
      },
    },
    404: problemDetailsResponse(404),
  },
});

export const jobHandlers = new OpenAPIHono<Env>()
  .openapi(listJobsRoute, async (c) => {
    const query = c.req.valid("query");
    const nowSeconds = Math.floor(Date.now() / 1000);

    const baseFilter = {
      ...(query.client ? { client: query.client.toLowerCase() } : {}),
      // The zero address means "no provider", which the subgraph stores as null.
      ...(query.provider
        ? {
            provider: isAddressEqual(query.provider, zeroAddress)
              ? null
              : query.provider.toLowerCase(),
          }
        : {}),
      ...(query.evaluator ? { evaluator: query.evaluator.toLowerCase() } : {}),
      ...(query.agentId !== undefined ? { providerAgentId: query.agentId.toString() } : {}),
    };

    const { jobs } = await c.var.mesh.ListJobs({
      first: query.limit,
      skip: query.skip,
      // `or` cannot sit next to sibling fields, so the base filter is repeated
      // inside each branch.
      where: query.status
        ? {
            or: statusFilters(query.status, nowSeconds).map((filter) => ({
              ...baseFilter,
              ...filter,
            })),
          }
        : baseFilter,
    });

    const result = listJobsOutputSchema.safeParse(jobs.map((job) => toJobSummary(job, nowSeconds)));
    if (!result.success) throw new Error(result.error.message);

    return c.json(result.data);
  })
  .openapi(getJobRoute, async (c) => {
    const jobId = c.req.valid("param").jobId.toString();
    const nowSeconds = Math.floor(Date.now() / 1000);

    const { jobs } = await c.var.mesh.GetJob({ jobId });
    const [job] = jobs;

    if (!job)
      throw problemDetails({
        status: 404,
        title: "Not found",
        detail: `Job with id ${jobId} not found`,
        type: "Job",
      });

    const result = getJobOutputSchema.safeParse(toJobSummary(job, nowSeconds));
    if (!result.success) throw new Error(result.error.message);

    return c.json(result.data);
  });
