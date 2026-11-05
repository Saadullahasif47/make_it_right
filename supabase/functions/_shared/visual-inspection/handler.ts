import { z } from "zod";

import { MAX_EVIDENCE_BYTES, sniffImageType } from "../evidence/image.ts";
import { JobError, type ClaimedJob, type JobHandler } from "../jobs/types.ts";
import { WorkerDatabaseError, type Rpc } from "../jobs/worker-db.ts";

import { analyseImage, type VisionOptions } from "./gemini-vision.ts";
import { VISUAL_SYSTEM_INSTRUCTION, buildVisualReportMessage } from "./prompt.ts";
import { VISUAL_PROMPT_VERSION, toStoredAnalysis } from "./schema.ts";

const EVIDENCE_BUCKET = "complaint-evidence";

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

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The visual_analysis job (plan v2 F1.05): load the photo's report, fetch the private image with
 * the service key, re-check its bytes against what was finalised, ask the model, apply the
 * review policy, and store the result. Safe to run again: the database keeps the first result
 * per photo and prompt version.
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

    const objectUrl = `${options.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${EVIDENCE_BUCKET}/${context.object_path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    let download: Response;
    try {
      download = await options.fetch(objectUrl, {
        headers: { apikey: options.serviceKey, authorization: `Bearer ${options.serviceKey}` },
        signal,
      });
    } catch (error) {
      throw new JobError("STORAGE_UNAVAILABLE", true, { cause: error });
    }
    if (download.status === 404 || download.status === 400) {
      throw new JobError("PHOTO_NOT_FOUND", false);
    }
    if (!download.ok) {
      throw new JobError("STORAGE_UNAVAILABLE", true);
    }

    const image = new Uint8Array(await download.arrayBuffer());
    // The bytes must be exactly the photo that was checked and finalised.
    if (
      image.byteLength > MAX_EVIDENCE_BYTES ||
      image.byteLength !== context.byte_size ||
      sniffImageType(image) !== context.mime_type ||
      (await sha256Hex(image)) !== context.sha256
    ) {
      throw new JobError("PHOTO_INTEGRITY", false);
    }

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
