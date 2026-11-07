import { z } from "zod";

import { downloadVerifiedPhoto } from "../evidence/download.ts";
import { JobError, type ClaimedJob, type JobHandler } from "../jobs/types.ts";
import { WorkerDatabaseError, type Rpc } from "../jobs/worker-db.ts";
import { generateStructured, type VisionOptions } from "../visual-inspection/gemini-vision.ts";

import { VERIFY_SYSTEM_INSTRUCTION, buildVerificationMessage } from "./prompt.ts";
import {
  COMPARISON_JSON_SCHEMA,
  MISSING_BEFORE,
  VERIFY_PROMPT_VERSION,
  comparisonSchema,
  toStoredVerification,
  type StoredVerification,
} from "./schema.ts";

const photoSchema = z.object({
  attachment_id: z.uuid(),
  object_path: z.string().min(1),
  mime_type: z.string(),
  byte_size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const contextSchema = z.object({
  review_id: z.uuid(),
  case_id: z.uuid(),
  reference: z.string(),
  after: photoSchema.nullable(),
  before: photoSchema.nullable(),
  reports: z.array(z.object({ title: z.string(), description: z.string() })),
});

export interface VerificationHandlerOptions {
  readonly rpc: Rpc;
  readonly supabaseUrl: string;
  readonly serviceKey: string;
  readonly fetch: typeof fetch;
  readonly vision:
    VisionOptions | { readonly unavailable: "AI_DISABLED" | "PROVIDER_NOT_CONFIGURED" };
}

/**
 * The repair_verify job (plan v2 F4.03): fetch the case's BEFORE and AFTER photos, re-check both
 * against what was finalised, ask the model for a paired comparison, apply the caution policy and
 * store the suggestion on the review. Without a before photo the answer is NOT_COMPARABLE and no
 * model is called. Safe to run again: the database keeps the first result per review, and nothing
 * here can change the case's status.
 */
export function createRepairVerificationHandler(options: VerificationHandlerOptions): JobHandler {
  const save = async (job: ClaimedJob, model: string, result: StoredVerification) => {
    try {
      await options.rpc("worker_save_verification", {
        p_job_id: job.jobId,
        p_msg_id: job.msgId,
        p_attempt: job.attempt,
        p_prompt_version: VERIFY_PROMPT_VERSION,
        p_model: model,
        p_result: result,
      });
    } catch (error) {
      if (
        error instanceof WorkerDatabaseError &&
        ["23514", "22P02", "22023"].includes(error.sqlState ?? "")
      ) {
        throw new JobError("INVALID_OUTPUT", false, { cause: error });
      }
      throw error;
    }
  };

  return async (job: ClaimedJob, signal: AbortSignal) => {
    const context = contextSchema
      .nullable()
      .parse(await options.rpc("worker_verification_context", { p_review_id: job.targetId }));
    if (context === null || context.after === null) {
      throw new JobError("PHOTO_NOT_FOUND", false);
    }
    if (context.before === null) {
      await save(job, "none", MISSING_BEFORE);
      return;
    }
    if ("unavailable" in options.vision) {
      throw new JobError(options.vision.unavailable, false);
    }

    const [before, after] = await Promise.all([
      downloadVerifiedPhoto(options, context.before, signal),
      downloadVerifiedPhoto(options, context.after, signal),
    ]);
    const comparison = await generateStructured(
      options.vision,
      {
        systemInstruction: VERIFY_SYSTEM_INSTRUCTION,
        message: buildVerificationMessage(context.reference, context.reports),
        images: [
          { label: "BEFORE photo:", bytes: before, mimeType: context.before.mime_type },
          { label: "AFTER photo:", bytes: after, mimeType: context.after.mime_type },
        ],
        jsonSchema: COMPARISON_JSON_SCHEMA,
      },
      comparisonSchema,
      signal,
    );
    await save(job, options.vision.model, toStoredVerification(comparison));
  };
}
