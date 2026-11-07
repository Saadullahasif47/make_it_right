import { z } from "zod";

import { downloadVerifiedPhoto } from "../evidence/download.ts";
import { JobError, type ClaimedJob, type JobHandler } from "../jobs/types.ts";
import { WorkerDatabaseError, type Rpc } from "../jobs/worker-db.ts";

import { analyseImage, type VisionOptions } from "./gemini-vision.ts";
import { VISUAL_SYSTEM_INSTRUCTION, buildVisualReportMessage } from "./prompt.ts";
import { VISUAL_PROMPT_VERSION, toStoredAnalysis } from "./schema.ts";

const contextSchema = z.object({
  attachment_id: z.uuid(),
  complaint_id: z.uuid(),
  object_path: z.string().min(1),
  mime_type: z.string(),
  byte_size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  title: z.string(),
  description: z.string(),
  building: z.string(),
  room: z.string().nullable(),
});

export interface VisualHandlerOptions {
  readonly rpc: Rpc;
  readonly supabaseUrl: string;
  readonly serviceKey: string;
  readonly fetch: typeof fetch;
  /** Null when AI is switched off or no key is configured; the code says which. */
  readonly vision:
    VisionOptions | { readonly unavailable: "AI_DISABLED" | "PROVIDER_NOT_CONFIGURED" };
}

/**
 * The visual_analysis job (plan v2 F1.05): load the photo's report, fetch the private image and
 * re-check its bytes against what was finalised, ask the model, apply the review policy, and
 * store the result. Safe to run again: the database keeps the first result per photo and
 * prompt version.
 */
export function createVisualAnalysisHandler(options: VisualHandlerOptions): JobHandler {
  return async (job: ClaimedJob, signal: AbortSignal) => {
    if ("unavailable" in options.vision) {
      throw new JobError(options.vision.unavailable, false);
    }

    const rows = z
      .array(contextSchema)
      .parse(await options.rpc("worker_visual_context", { p_attachment_id: job.targetId }));
    const context = rows[0];
    if (context === undefined) {
      throw new JobError("PHOTO_NOT_FOUND", false);
    }

    const image = await downloadVerifiedPhoto(options, context, signal);
    const output = await analyseImage(
      options.vision,
      {
        systemInstruction: VISUAL_SYSTEM_INSTRUCTION,
        message: buildVisualReportMessage(context),
        image,
        mimeType: context.mime_type,
      },
      signal,
    );

    try {
      await options.rpc("worker_save_visual_analysis", {
        p_job_id: job.jobId,
        p_msg_id: job.msgId,
        p_attempt: job.attempt,
        p_prompt_version: VISUAL_PROMPT_VERSION,
        p_model: options.vision.model,
        p_result: toStoredAnalysis(output),
      });
    } catch (error) {
      // The database refusing the values is a content problem; trying again would not help.
      if (
        error instanceof WorkerDatabaseError &&
        ["23514", "22P02", "22023"].includes(error.sqlState ?? "")
      ) {
        throw new JobError("INVALID_OUTPUT", false, { cause: error });
      }
      throw error;
    }
  };
}
