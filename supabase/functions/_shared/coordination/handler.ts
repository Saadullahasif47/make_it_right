import { z } from "zod";

import { JobError, type ClaimedJob, type JobHandler } from "../jobs/types.ts";
import type { Rpc } from "../jobs/worker-db.ts";

import { approvedRoutesSchema, caseContextSchema } from "./context.ts";
import { runCoordinator } from "./coordinator.ts";
import {
  createGeminiCoordinatorModel,
  type CoordinatorModel,
  type GeminiToolOptions,
} from "./model.ts";
import { approvalReasons } from "./policy.ts";
import { COORDINATOR_PROMPT_VERSION } from "./prompt.ts";

type Unavailable = { readonly unavailable: "AI_DISABLED" | "PROVIDER_NOT_CONFIGURED" };

export interface CoordinationHandlerOptions {
  readonly rpc: Rpc;
  readonly provider: GeminiToolOptions | Unavailable;
  /** Tests inject a scripted model; production builds the Gemini one from the provider. */
  readonly model?: CoordinatorModel;
  readonly now?: () => number;
}

const capacitySchema = z.object({ active_work_orders: z.number().int().nonnegative() }).loose();
const historySchema = z.array(z.object({ opened_at: z.string() }).loose());

/**
 * The coordination job (plan v2 §08 controlled execution):
 *   1. load the bounded case context and the approved routes;
 *   2. let the model read (at most four times) and finish with a proposal or a review request;
 *   3. apply the deterministic approval policy, with the department's real load and the
 *      equipment's real history (never the model's claims);
 *   4. record model, prompt version, trace, reasons and outcome; the database commits a
 *      low-risk proposal once, against the case version the run started from.
 * If the provider is unavailable the job retries and then waits for review; the case keeps its
 * current routing and can be routed by hand at any time.
 */
export function createCoordinationHandler(options: CoordinationHandlerOptions): JobHandler {
  const now = options.now ?? Date.now;
  return async (job: ClaimedJob, signal: AbortSignal) => {
    const started = now();
    const context = caseContextSchema
      .nullable()
      .parse(await options.rpc("worker_case_context", { p_case_id: job.targetId }));
    if (context === null) {
      throw new JobError("CASE_NOT_FOUND", false);
    }
    const routes = approvedRoutesSchema.parse(await options.rpc("worker_approved_routes", {}));

    let model = options.model;
    if (model === undefined) {
      if ("unavailable" in options.provider) {
        throw new JobError(options.provider.unavailable, false);
      }
      model = createGeminiCoordinatorModel(options.provider);
    }

    const reads = {
      assetHistory: (assetId: string) =>
        options.rpc("worker_asset_history", { p_asset_id: assetId, p_days: 90 }),
      departmentCapacity: (departmentId: string) =>
        options.rpc("worker_department_capacity", { p_department_id: departmentId }),
      relatedCases: (locationId: string, category: string | undefined) =>
        options.rpc("worker_related_cases", {
          p_location_id: locationId,
          p_category: category ?? null,
          p_exclude_case: context.case_id,
        }),
    };

    const result = await runCoordinator({ model, context, routes, reads, signal, now });

    let policyReasons: readonly string[] = [];
    if (result.kind === "proposal") {
      const capacity = capacitySchema
        .nullable()
        .parse(await reads.departmentCapacity(result.proposal.departmentId));
      const history =
        context.asset === null
          ? []
          : historySchema.parse(
              await options.rpc("worker_asset_history", {
                p_asset_id: context.asset.asset_id,
                p_days: 30,
              }),
            );
      policyReasons = approvalReasons({
        context,
        proposal: result.proposal,
        departmentLoad: capacity?.active_work_orders ?? 0,
        recentAssetCases: history.length,
      });
    }

    await options.rpc("worker_finish_coordination", {
      p_job_id: job.jobId,
      p_msg_id: job.msgId,
      p_attempt: job.attempt,
      p_model: model.model,
      p_prompt_version: COORDINATOR_PROMPT_VERSION,
      p_case_version: context.version,
      // Unknown tools and out-of-scope ids appear as their own verdicts in the trace.
      p_tool_trace: result.trace,
      p_duration_ms: Math.min(600_000, Math.max(0, Math.round(now() - started))),
      p_reason_code: result.kind === "review" ? result.reasonCode : null,
      p_proposal:
        result.kind === "proposal"
          ? {
              department_id: result.proposal.departmentId,
              category: result.proposal.category,
              priority: result.proposal.priority,
              rationale: result.proposal.rationale,
            }
          : null,
      p_policy_reasons: policyReasons,
      p_auto_commit: result.kind === "proposal" && policyReasons.length === 0,
    });
  };
}
