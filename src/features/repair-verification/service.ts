import "server-only";

import { EvidenceError, evidenceErrorFromDatabase } from "@/features/evidence/errors";
import {
  checkUploadedPhoto,
  signPhotoUrls,
  signedUploadSlot,
  type UploadSlot,
} from "@/features/evidence/service";
import type { Logger } from "@/lib/logging/logger";
import type { AppSupabaseClient } from "@/lib/supabase/server";

import {
  finalizedRepairSchema,
  verificationViewSchema,
  type AiStatus,
  type RepairEvidenceKind,
  type RepairUploadRequest,
  type ReviewState,
  type VerificationDecision,
} from "./schemas";

/**
 * Reserves a repair photo on a case and returns a signed direct-upload URL (plan v2 F4.01).
 * The database allows only the department holding the case and administrators.
 */
export async function requestRepairUpload(
  client: AppSupabaseClient,
  logger: Logger,
  caseId: string,
  input: RepairUploadRequest,
): Promise<UploadSlot> {
  const { data, error } = await client
    .rpc("request_repair_evidence_upload", {
      p_case_id: caseId,
      p_kind: input.kind,
      p_mime_type: input.mimeType,
      p_byte_size: input.byteSize,
    })
    .single();
  if (error !== null) {
    throw evidenceErrorFromDatabase(error);
  }
  const slot = await signedUploadSlot(client, logger, data);
  logger.info("repair.upload_requested", {
    caseId,
    attachmentId: slot.attachmentId,
    kind: input.kind,
  });
  return slot;
}

export interface FinalizedRepairPhoto {
  readonly attachmentId: string;
  /** Set for an after photo: the verification it opened and the comparison job. */
  readonly reviewId: string | null;
  readonly jobId: string | null;
}

/**
 * Checks the uploaded bytes and finalises the repair photo; an after photo opens a verification
 * review and queues the comparison in the same transaction. Repeating the call is harmless.
 */
export async function finalizeRepairUpload(
  client: AppSupabaseClient,
  logger: Logger,
  caseId: string,
  attachmentId: string,
): Promise<FinalizedRepairPhoto> {
  const { data: row, error } = await client
    .from("evidence_attachments")
    .select("id, object_path, mime_type, byte_size, state")
    .eq("id", attachmentId)
    .eq("case_id", caseId)
    .maybeSingle();
  if (error !== null) {
    throw evidenceErrorFromDatabase(error);
  }
  if (row === null) {
    throw new EvidenceError("NOT_FOUND");
  }
  const sha256 =
    row.state === "pending" ? await checkUploadedPhoto(client, logger, row) : "0".repeat(64);

  const { data, error: finalizeError } = await client
    .rpc("finalize_repair_evidence_upload", {
      p_attachment_id: row.id,
      p_sha256: sha256,
      p_byte_size: row.byte_size,
      p_mime_type: row.mime_type,
    })
    .single();
  if (finalizeError !== null) {
    throw evidenceErrorFromDatabase(finalizeError);
  }
  const finalized = finalizedRepairSchema.parse(data);
  logger.info("repair.photo_finalized", {
    attachmentId: finalized.attachment_id,
    reviewId: finalized.review_id,
    jobId: finalized.job_id,
  });
  return {
    attachmentId: finalized.attachment_id,
    reviewId: finalized.review_id,
    jobId: finalized.job_id,
  };
}

export type DecisionFailure =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "STALE_VERSION"
  | "INVALID_TRANSITION"
  | "VALIDATION_FAILED"
  | "SERVICE_UNAVAILABLE";

export class DecisionError extends Error {
  override readonly name = "DecisionError";
  readonly code: DecisionFailure;

  constructor(code: DecisionFailure, options?: ErrorOptions) {
    super(code, options);
    this.code = code;
  }
}

function decisionFailure(code: string | undefined): DecisionFailure {
  switch (code) {
    case "42501":
      return "UNAUTHENTICATED";
    case "MR403":
      return "FORBIDDEN";
    case "MR404":
      return "NOT_FOUND";
    case "MR412":
      return "STALE_VERSION";
    case "MR422":
      return "INVALID_TRANSITION";
    case "22023":
      return "VALIDATION_FAILED";
    case undefined:
    default:
      return "SERVICE_UNAVAILABLE";
  }
}

/**
 * A person's decision on a verification (plan v2 F4.04-F4.05): a reporter confirms or disputes
 * their own report, an administrator closes or reopens the case. Returns the case's new status.
 */
export async function decideVerification(
  client: AppSupabaseClient,
  caseId: string,
  input: VerificationDecision,
): Promise<string> {
  const { data: review, error: lookupError } = await client
    .from("verification_reviews")
    .select("case_id")
    .eq("id", input.reviewId)
    .maybeSingle();
  if (lookupError !== null) {
    throw new DecisionError("SERVICE_UNAVAILABLE", { cause: lookupError });
  }
  if (review?.case_id !== caseId) {
    throw new DecisionError("NOT_FOUND");
  }
  const { data, error } = await client.rpc("decide_repair_verification", {
    p_review_id: input.reviewId,
    p_confirm: input.confirm,
    ...(input.note === undefined || input.note === "" ? {} : { p_note: input.note }),
  });
  if (error !== null) {
    throw new DecisionError(decisionFailure(error.code), { cause: error });
  }
  return data;
}

export interface RepairPhoto {
  readonly id: string;
  readonly kind: RepairEvidenceKind;
  readonly addedAt: string;
  readonly url: string | null;
}

export interface VerificationReview {
  readonly id: string;
  readonly state: ReviewState;
  readonly aiStatus: AiStatus | null;
  readonly model: string | null;
  readonly promptVersion: string | null;
  readonly beforeObservations: readonly string[];
  readonly afterObservations: readonly string[];
  readonly visibleChanges: readonly string[];
  readonly notVisible: readonly string[];
  readonly flags: readonly string[];
  readonly explanation: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  readonly beforeSource: "report" | "repair" | null;
  /** Null when there is no before photo or the viewer may not see it (another reporter's). */
  readonly beforeUrl: string | null;
  readonly afterUrl: string | null;
}

export interface RepairVerificationView {
  readonly caseId: string;
  readonly reference: string;
  readonly caseStatus: string;
  readonly canUpload: boolean;
  readonly photos: readonly RepairPhoto[];
  readonly reviews: readonly VerificationReview[];
}

/** The repair evidence and verifications of one report's case, with five-minute photo links. */
export async function loadRepairVerification(
  client: AppSupabaseClient,
  complaintId: string,
): Promise<RepairVerificationView | null> {
  const { data, error } = await client.rpc("repair_verification_view", {
    p_complaint_id: complaintId,
  });
  if (error !== null) {
    throw new Error(`repair verification lookup failed: ${error.code}`);
  }
  if (data === null) return null;
  const view = verificationViewSchema.parse(data);

  const paths = [
    ...view.photos.map((photo) => photo.object_path),
    ...view.reviews.flatMap((review) =>
      [review.before_path, review.after_path].filter((path): path is string => path !== null),
    ),
  ];
  // A photo the viewer may not read simply gets no link.
  const urls = await signPhotoUrls(client, [...new Set(paths)]);
  const url = (path: string | null) => (path === null ? null : (urls.get(path) ?? null));

  return {
    caseId: view.case_id,
    reference: view.reference,
    caseStatus: view.case_status,
    canUpload: view.can_upload,
    photos: view.photos.map((photo) => ({
      id: photo.attachment_id,
      kind: photo.kind,
      addedAt: photo.added_at,
      url: url(photo.object_path),
    })),
    reviews: view.reviews.map((review) => ({
      id: review.id,
      state: review.state,
      aiStatus: review.ai_status,
      model: review.model,
      promptVersion: review.prompt_version,
      beforeObservations: review.ai_result?.before_observations ?? [],
      afterObservations: review.ai_result?.after_observations ?? [],
      visibleChanges: review.ai_result?.visible_changes ?? [],
      notVisible: review.ai_result?.not_visible_or_uncertain ?? [],
      flags: review.uncertainty_flags,
      explanation: review.explanation,
      createdAt: review.created_at,
      decidedAt: review.decided_at,
      decisionNote: review.decision_note,
      beforeSource: review.before_source,
      beforeUrl: url(review.before_path),
      afterUrl: url(review.after_path),
    })),
  };
}
