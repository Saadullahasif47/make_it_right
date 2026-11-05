import { z } from "zod";

import { JobError, type ClaimedJob, type JobHandler } from "../jobs/types.ts";
import type { Rpc } from "../jobs/worker-db.ts";

import { canonicalText, embedText, sha256Hex, type EmbeddingOptions } from "./embeddings.ts";
import { rankCandidates } from "./ranking.ts";

type Unavailable = { readonly unavailable: "AI_DISABLED" | "PROVIDER_NOT_CONFIGURED" };

export interface DuplicateHandlerOptions {
  readonly rpc: Rpc;
  readonly embedding: EmbeddingOptions | Unavailable;
  /** The model whose vectors are compared; recorded on every vector and candidate. */
  readonly model: string;
}

const contextSchema = z.object({
  complaint_id: z.uuid(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  model: z.string().nullable(),
  text_hash: z.string().nullable(),
});

const featureSchema = z.object({
  case_id: z.uuid(),
  case_reference: z.number().int(),
  similarity: z.number().min(-1).max(1),
  same_building: z.boolean(),
  same_room: z.boolean(),
  category_match: z.boolean(),
  same_asset: z.boolean(),
});

/**
 * The embedding job (F2.02): embed the report's canonical text with the pinned model, then the
 * database queues its duplicate match. Unchanged text under the same model is never sent to
 * the provider again.
 */
export function createEmbeddingHandler(options: DuplicateHandlerOptions): JobHandler {
  return async (job: ClaimedJob, signal: AbortSignal) => {
    const [context] = z
      .array(contextSchema)
      .parse(await options.rpc("worker_embedding_context", { p_complaint_id: job.targetId }));
    if (context === undefined) {
      throw new JobError("REPORT_NOT_FOUND", false);
    }
    const text = canonicalText(context);
    const textHash = await sha256Hex(text);
    const unchanged = context.model === options.model && context.text_hash === textHash;

    let embedding: number[] | null = null;
    if (!unchanged) {
      if ("unavailable" in options.embedding) {
        throw new JobError(options.embedding.unavailable, false);
      }
      embedding = await embedText(options.embedding, text, signal);
    }

    await options.rpc("worker_save_embedding", {
      p_job_id: job.jobId,
      p_msg_id: job.msgId,
      p_attempt: job.attempt,
      p_model: options.model,
      p_text_hash: textHash,
      p_embedding: embedding,
    });
  };
}

/**
 * The duplicate_match job (F2.03): the database finds open cases in the same building with
 * their similarity and exact features; this code ranks them and stores the few worth a
 * person's review. Nothing is linked here.
 */
export function createDuplicateMatchHandler(options: DuplicateHandlerOptions): JobHandler {
  return async (job: ClaimedJob) => {
    const features = z.array(featureSchema).parse(
      await options.rpc("worker_duplicate_features", {
        p_complaint_id: job.targetId,
        p_model: options.model,
        p_limit: 10,
      }),
    );
    const ranked = rankCandidates(
      features.map((row) => ({
        caseId: row.case_id,
        similarity: row.similarity,
        sameBuilding: row.same_building,
        sameRoom: row.same_room,
        categoryMatch: row.category_match,
        sameAsset: row.same_asset,
      })),
    );
    await options.rpc("worker_save_match_candidates", {
      p_job_id: job.jobId,
      p_msg_id: job.msgId,
      p_attempt: job.attempt,
      p_model: options.model,
      p_candidates: ranked.map((candidate) => ({
        case_id: candidate.caseId,
        similarity: candidate.similarity,
        score: candidate.score,
        same_building: candidate.sameBuilding,
        same_room: candidate.sameRoom,
        category_match: candidate.categoryMatch,
        same_asset: candidate.sameAsset,
      })),
    });
  };
}
